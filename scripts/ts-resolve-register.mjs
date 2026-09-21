// scripts/ts-resolve-register.mjs
// Registers the extensionless-import resolver for the Node test scripts.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./ts-resolve-hook.mjs", pathToFileURL(`${import.meta.dirname}/`));
