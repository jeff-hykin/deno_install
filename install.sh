#!/bin/sh
# Copyright 2019 the Deno authors. All rights reserved. MIT license.
# TODO(everyone): Keep this script simple and easily auditable.

set -e

if ! command -v unzip >/dev/null && ! command -v 7z >/dev/null; then
	echo "Error: either unzip or 7z is required to install Deno (see: https://github.com/denoland/deno_install#either-unzip-or-7z-is-required )." 1>&2
	exit 1
fi

if [ "$OS" = "Windows_NT" ]; then
	target="x86_64-pc-windows-msvc"
else
	case $(uname -sm) in
	"Darwin x86_64") target="x86_64-apple-darwin" ;;
	"Darwin arm64") target="aarch64-apple-darwin" ;;
	"Linux aarch64") target="aarch64-unknown-linux-gnu" ;;
	*) target="x86_64-unknown-linux-gnu" ;;
	esac
fi

if [ $# -eq 0 ]; then
	deno_version="$(curl -s https://dl.deno.land/release-latest.txt)"
else
	deno_version=$1
fi

deno_uri="https://dl.deno.land/release/${deno_version}/deno-${target}.zip"
deno_install="${DENO_INSTALL:-$HOME/.deno}"
bin_dir="$deno_install/bin"
exe="$bin_dir/deno"

if [ ! -d "$bin_dir" ]; then
	mkdir -p "$bin_dir"
fi

curl --fail --location --progress-bar --output "$exe.zip" "$deno_uri"
if command -v unzip >/dev/null; then
	unzip -d "$bin_dir" -o "$exe.zip"
else
	7z x -o"$bin_dir" -y "$exe.zip"
fi
chmod +x "$exe"
rm "$exe.zip"

echo "Deno was installed successfully to $exe"
if $exe eval 'const [major, minor] = Deno.version.deno.split("."); if (major < 2 && minor < 42) Deno.exit(1)'; then

	allow_sys_perm="--allow-sys=homedir"

	if ! echo | $exe run --allow-sys=homedir - >/dev/null 2>&1; then
		allow_sys_perm="--allow-sys"
	fi
	$exe run $allow_sys_perm --no-check --allow-run="zsh,$exe" --allow-read --allow-env --allow-write="$deno_install" ./shell-setup/src/main.ts "$deno_install"
fi
if command -v deno >/dev/null; then
	echo "Run 'deno --help' to get started"
else
	echo "Run '$exe --help' to get started"
fi
echo
echo "Stuck? Join our Discord https://discord.gg/deno"
