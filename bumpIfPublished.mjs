// Run by prepublishOnly, so `npm publish` always publishes a new version: when this version is already on
// npm, it bumps the patch version with `npm version patch`, which commits and tags it. A version that isn't
// on npm yet, such as one bumped by hand or left by a failed publish, is published as it is.
import { execSync } from 'node:child_process';

const { npm_package_name: name, npm_package_version: version, npm_config_dry_run: dryRun } = process.env;

let published = false;
try {
	published = !!execSync(`npm view ${name}@${version} version`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {
	// the package isn't on npm at all yet
}

if (!published) {
	console.log(`${name}@${version} isn't on npm yet, so it's published as it is`);
} else if (dryRun === 'true') {
	console.log(`${name}@${version} is already on npm, so a real publish would bump the patch version`);
} else {
	execSync('npm version patch', { stdio: 'inherit' });
}
