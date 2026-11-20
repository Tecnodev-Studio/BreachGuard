#!/usr/bin/env python3
"""Fail if the built APK requests permissions beyond the allowlist.

Usage (CI):  aapt2 dump permissions app-debug.apk | python3 scripts/check_apk_permissions.py
Allowed: android.permission.INTERNET, and AndroidX's auto-generated
<applicationId>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION (receiver hardening, not a data permission).
"""
import re
import sys

ALLOWED_EXACT = {"android.permission.INTERNET"}
ALLOWED_SUFFIX = ".DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"


def requested_permissions(dump: str) -> set:
    return set(re.findall(r"uses-permission(?:-sdk-\d+)?:\s*name='([^']+)'", dump))


def violations(dump: str) -> list:
    return sorted(p for p in requested_permissions(dump)
                  if p not in ALLOWED_EXACT and not p.endswith(ALLOWED_SUFFIX))


if __name__ == "__main__":
    data = sys.stdin.read()
    found = requested_permissions(data)
    if not found:
        print("ERROR: no permissions parsed from aapt2 output; refusing to pass blindly")
        print(data[:500])
        sys.exit(2)
    print("Requested permissions:", ", ".join(sorted(found)))
    bad = violations(data)
    if bad:
        print("UNEXPECTED PERMISSIONS:", ", ".join(bad))
        sys.exit(1)
    print("APK permission check: PASS")
