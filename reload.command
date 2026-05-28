#!/bin/bash
# Ricarica farafitness.netlify.app in Safari svuotando la cache
/usr/bin/osascript <<EOF
tell application "Safari"
    activate
    set URL of current tab of front window to "https://farafitness.netlify.app"
end tell
EOF
sleep 2
# Hard reload (Cmd+Shift+R)
/usr/bin/osascript -e 'tell application "Safari" to activate'
/usr/bin/osascript -e 'tell application "System Events" to keystroke "r" using {command down, shift down}'
