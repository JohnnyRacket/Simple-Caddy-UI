#!/bin/bash
# Fake journalctl stub — streams or dumps Caddy's log file.
# The app calls: journalctl -u caddy -f --no-pager -o short-iso  (follow)
#           and: journalctl -u caddy -n 500 --no-pager -o json  (recent entries; lines are Caddy's own JSON)
if [[ " $* " == *" -f "* ]]; then
  exec tail -f -n 50 /var/log/caddy/caddy.log
fi
exec tail -n 500 /var/log/caddy/caddy.log
