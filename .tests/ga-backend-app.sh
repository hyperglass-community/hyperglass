#!/usr/bin/env bash

LOG_FILE="$HOME/hyperglass-ci.log"
touch /tmp/hyperglass.log

. .venv/bin/activate

echo "[INFO] Starting setup..."
python3 -m hyperglass.console setup -d &>$LOG_FILE
echo "[SUCCESS] Setup completed."
sleep 2

echo "[INFO] Copying directives.yaml file..."
cp ./.tests/directives.yaml $HOME/hyperglass/directives.yaml

echo "[INFO] Copying devices.yaml file..."
cp ./.tests/devices.yaml $HOME/hyperglass/devices.yaml

echo "[INFO] Starting UI build."
python3 -m hyperglass.console build-ui &>$LOG_FILE

if [[ ! $? == 0 ]]; then
    echo "[ERROR] Failed to build hyperglass ui."
    cat /tmp/hyperglass.log
    cat $LOG_FILE
    exit 1
else
    echo "[SUCCESS] UI build completed."
fi

echo "[INFO] Starting hyperglass..."
python3 -m hyperglass.console start &>$LOG_FILE &
HYPERGLASS_PID=$!
trap 'kill $HYPERGLASS_PID 2>/dev/null' EXIT

# Poll until hyperglass answers 200, the process exits, or the timeout passes.
STARTUP_TIMEOUT=${HYPERGLASS_STARTUP_TIMEOUT:-300}
URL="http://127.0.0.1:8001"
STATUS="000"
START_TIME=$SECONDS

while true; do
    if ! kill -0 $HYPERGLASS_PID 2>/dev/null; then
        wait $HYPERGLASS_PID
        echo "[ERROR] hyperglass exited with status $? before it was ready."
        cat /tmp/hyperglass.log
        cat $LOG_FILE
        exit 1
    fi

    STATUS=$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" $URL)
    if [[ "$STATUS" == "200" ]]; then
        break
    fi

    if (( SECONDS - START_TIME >= STARTUP_TIMEOUT )); then
        echo "[ERROR] hyperglass did not return 200 within ${STARTUP_TIMEOUT}s (last status: $STATUS)."
        cat /tmp/hyperglass.log
        cat $LOG_FILE
        exit 1
    fi

    sleep 2
done

echo "[SUCCESS] hyperglass returned $STATUS after $((SECONDS - START_TIME))s."
echo "[SUCCESS] Tests ran successfully."
exit 0
