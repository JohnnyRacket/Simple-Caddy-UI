#!/bin/bash
# Fake journalctl stub — ignores all flags, streams Caddy's log file.
# The app calls: journalctl -u caddy -f --no-pager -o short-iso
exec tail -f -n 50 /var/log/caddy/caddy.log
