#!/bin/sh
# Copyright 2019 the Deno authors. All rights reserved. MIT license.
# TODO(everyone): Keep this script simple and easily auditable.

set -e

has() {
	command -v "$1" >/dev/null
}

if ! has unzip; then
    # if interactive/tty
    if [ -t 0 ]; then
        # ask user about auto-install
        echo "Should I try to install unzip for you? (its required for this to work) ";read ANSWER;echo; 
        if [ "$ANSWER" =~ ^[Yy] ]; then 
            base_command=""
            if has apt-get; then
                base_command="apt-get install unzip -y"
            elif has pacman; then
                base_command="sudo pacman -S unzip"
            fi
            
            # install unzip if needed
            if [ -n "$base_command" ]
            then
                if [ "$(whoami)" = "root" ]; then 
                    eval $base_command
                elif has sudo; then 
                    eval sudo $base_command
                elif has doas; then 
                    eval doas $base_command
                fi
            fi
        fi
    fi
fi
# if still doesn't have unzip
if ! has unzip; then 
    echo "";
    echo "Error: unzip is required to install Deno (see: https://github.com/denoland/deno_install#unzip-is-required )." 1>&2
    echo "I couldn't find an 'unzip' command";
    echo "And I tried to auto install it, but it seems that failed";
    echo "(This script needs unzip and either curl or wget)";
    echo "Please install the unzip command manually then re-run this script";
    exit 1; 
fi; 

if [ "$OS" = "Windows_NT" ]; then
	target="x86_64-pc-windows-msvc"
else
	case $(uname -sm) in
	"Darwin x86_64") target="x86_64-apple-darwin" ;;
	"Darwin arm64") target="aarch64-apple-darwin" ;;
	"Linux aarch64")
		echo "Error: Official Deno builds for Linux aarch64 are not available. (see: https://github.com/denoland/deno/issues/1846 )" 1>&2
		exit 1
		;;
	*) target="x86_64-unknown-linux-gnu" ;;
	esac
fi

if [ $# -eq 0 ]; then
	deno_uri="https://github.com/denoland/deno/releases/latest/download/deno-${target}.zip"
else
	deno_uri="https://github.com/denoland/deno/releases/download/${1}/deno-${target}.zip"
fi

deno_install="${DENO_INSTALL:-$HOME/.deno}"
bin_dir="$deno_install/bin"
exe="$bin_dir/deno"

if [ ! -d "$bin_dir" ]; then
	mkdir -p "$bin_dir"
fi

if has curl; then 
    curl --fail --location --progress-bar --output "$exe.zip" "$deno_uri"
elif has wget; then # basic ubuntu only has wget
    wget --output-document="$exe.zip" "$deno_uri"
else
    echo "When installing deno, I looked for the 'curl' and for 'wget' commands but I didn't see either of them."
    echo "Please install one of them"
    echo "Otherwise I have no way to install Deno"
fi
unzip -d "$bin_dir" -o "$exe.zip"
chmod +x "$exe"
rm "$exe.zip"

echo "Deno was installed successfully to $exe"
if has deno; then
	echo "Run 'deno --help' to get started"
else
	case $SHELL in
	/bin/zsh) shell_profile=".zshrc" ;;
	*) shell_profile=".bashrc" ;;
	esac
	echo "Manually add the directory to your \$HOME/$shell_profile (or similar)"
	echo "  export DENO_INSTALL=\"$deno_install\""
	echo "  export PATH=\"\$DENO_INSTALL/bin:\$PATH\""
	echo "Run '$exe --help' to get started"
fi
echo
echo "Stuck? Join our Discord https://discord.gg/deno"
