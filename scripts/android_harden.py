#!/usr/bin/env python3
"""Harden the Capacitor-generated Android project and VERIFY the result.

Run after `npx cap add android && npx cap sync android`:
    python3 scripts/android_harden.py android

Exit status is non-zero if the final AndroidManifest.xml does not meet the policy
below, so a weak configuration can never silently produce an APK in CI.

Policy enforced on the manifest:
  * android:allowBackup="false"
  * android:usesCleartextTraffic="false" and a network security config forbidding cleartext
  * no android:debuggable attribute
  * the only permission is android.permission.INTERNET
  * every activity/service/receiver/provider declares android:exported explicitly,
    and the only exported component is the launcher activity

Standard library only (no pip install needed in CI).
"""
import re
import shutil
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ANDROID_NS = "http://schemas.android.com/apk/res/android"
A = "{%s}" % ANDROID_NS
ALLOWED_PERMISSIONS = {"android.permission.INTERNET"}
BACKGROUND = "#0B1020"

NETWORK_SECURITY_CONFIG = """<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
"""

SPLASH_XML = """<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item>
        <shape android:shape="rectangle">
            <solid android:color="%s" />
        </shape>
    </item>
    <item
        android:width="160dp"
        android:height="160dp"
        android:gravity="center"
        android:drawable="@drawable/splash_logo" />
</layer-list>
""" % BACKGROUND


def _set_attr(tag: str, name: str, value: str) -> str:
    """Set (or replace) android:<name>="value" inside a single opening tag string."""
    pattern = re.compile(r'\s+android:%s\s*=\s*"[^"]*"' % re.escape(name))
    tag = pattern.sub("", tag)
    return re.sub(r"(<application\b)", r'\1\n        android:%s="%s"' % (name, value), tag, count=1)


def patch_manifest(text: str) -> str:
    m = re.search(r"<application\b[^>]*>", text, flags=re.S)
    if not m:
        raise ValueError("no <application> element found")
    tag = m.group(0)
    for name, value in (
        ("allowBackup", "false"),
        ("usesCleartextTraffic", "false"),
        ("networkSecurityConfig", "@xml/network_security_config"),
    ):
        tag = _set_attr(tag, name, value)
    # Never ship a debuggable flag from source.
    tag = re.sub(r'\s+android:debuggable\s*=\s*"[^"]*"', "", tag)
    return text[: m.start()] + tag + text[m.end():]


def verify_manifest(text: str) -> list:
    """Return a list of human-readable policy violations (empty list = pass)."""
    errors = []
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        return ["manifest is not well-formed XML: %s" % e]
    app = root.find("application")
    if app is None:
        return ["no <application> element"]
    if app.get(A + "allowBackup") != "false":
        errors.append('android:allowBackup must be "false"')
    if app.get(A + "usesCleartextTraffic") != "false":
        errors.append('android:usesCleartextTraffic must be "false"')
    if not app.get(A + "networkSecurityConfig"):
        errors.append("android:networkSecurityConfig is missing")
    if app.get(A + "debuggable") is not None:
        errors.append("android:debuggable must not be set in the manifest")

    perms = {p.get(A + "name") for p in root.findall("uses-permission")}
    perms |= {p.get(A + "name") for p in root.findall("uses-permission-sdk-23")}
    extra = perms - ALLOWED_PERMISSIONS
    if extra:
        errors.append("unexpected permissions: %s" % ", ".join(sorted(x or "?" for x in extra)))

    for kind in ("activity", "activity-alias", "service", "receiver", "provider"):
        for comp in app.findall(kind):
            name = comp.get(A + "name", "?")
            exported = comp.get(A + "exported")
            if exported is None:
                errors.append("%s %s has no explicit android:exported" % (kind, name))
                continue
            if exported == "true":
                is_launcher = any(
                    c.get(A + "name") == "android.intent.category.LAUNCHER"
                    for f in comp.findall("intent-filter")
                    for c in f.findall("category")
                )
                if not (kind == "activity" and is_launcher):
                    errors.append("%s %s is exported but is not the launcher activity" % (kind, name))
    return errors


def apply_splash(res: Path) -> list:
    """Best-effort branded splash. Returns warnings (never raises)."""
    warnings = []
    for png in res.glob("drawable*/splash.png"):
        png.unlink()
    drawable = res / "drawable"
    drawable.mkdir(parents=True, exist_ok=True)
    (drawable / "splash.xml").write_text(SPLASH_XML, encoding="utf-8")

    styles = res / "values" / "styles.xml"
    if styles.exists():
        s = styles.read_text(encoding="utf-8")
        m = re.search(r'(<style\s+name="AppTheme\.NoActionBarLaunch"\s+parent="[^"]*SplashScreen[^"]*"\s*>)(.*?)(</style>)', s, flags=re.S)
        if m and "windowSplashScreenBackground" not in m.group(2):
            extra = (
                '\n        <item name="windowSplashScreenBackground">%s</item>'
                '\n        <item name="windowSplashScreenAnimatedIcon">@drawable/splash_logo</item>\n    ' % BACKGROUND
            )
            s = s[: m.end(2)] + extra + s[m.end(2):]
            styles.write_text(s, encoding="utf-8")
        elif not m:
            warnings.append("AppTheme.NoActionBarLaunch (SplashScreen parent) not found; Android 12+ splash left default")
    else:
        warnings.append("values/styles.xml not found")

    bg = res / "values" / "ic_launcher_background.xml"
    if bg.exists():
        t = bg.read_text(encoding="utf-8")
        t2 = re.sub(r'(<color\s+name="ic_launcher_background">)[^<]*(</color>)', r"\g<1>%s\g<2>" % BACKGROUND, t)
        bg.write_text(t2, encoding="utf-8")
    return warnings


def harden(android_dir: Path, repo_root: Path) -> int:
    manifest = android_dir / "app" / "src" / "main" / "AndroidManifest.xml"
    res = android_dir / "app" / "src" / "main" / "res"
    if not manifest.exists():
        print("ERROR: %s not found. Run `npx cap add android` first." % manifest)
        return 2

    (res / "xml").mkdir(parents=True, exist_ok=True)
    (res / "xml" / "network_security_config.xml").write_text(NETWORK_SECURITY_CONFIG, encoding="utf-8")

    manifest.write_text(patch_manifest(manifest.read_text(encoding="utf-8")), encoding="utf-8")

    src_res = repo_root / "android-res" / "res"
    if src_res.is_dir():
        for f in src_res.rglob("*"):
            if f.is_file():
                dest = res / f.relative_to(src_res)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(f, dest)
    else:
        print("WARNING: android-res/res missing; default Capacitor icons kept")

    for w in apply_splash(res):
        print("WARNING:", w)

    errors = verify_manifest(manifest.read_text(encoding="utf-8"))
    if errors:
        print("ANDROID MANIFEST POLICY FAILED:")
        for e in errors:
            print("  -", e)
        return 1
    print("Android manifest policy: PASS")
    return 0


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "android").resolve()
    sys.exit(harden(target, Path(__file__).resolve().parent.parent))
