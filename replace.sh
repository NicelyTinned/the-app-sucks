
#!/usr/bin/env bash
set -euo pipefail

ZIP="${1:?Usage: ./replace.sh /path/to/archive.zip}"

if [[ ! -f "$ZIP" ]]; then
    echo "Error: ZIP file not found: $ZIP"
    exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Extracting archive..."
unzip -q "$ZIP" -d "$TMP"

# Detect whether ZIP contains one root folder
shopt -s dotglob nullglob
ITEMS=("$TMP"/*)

if [[ ${#ITEMS[@]} -eq 1 && -d "${ITEMS[0]}" ]]; then
    SOURCE="${ITEMS[0]}"
else
    SOURCE="$TMP"
fi

echo "Copying files into: $(pwd)"

# Copy everything, including hidden files, overwriting existing files
cp -a "$SOURCE"/. .

echo "Done! Files extracted and overwritten successfully."

