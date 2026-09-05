import { classifyIntent } from '../vendor/raw-inference.mjs';
export function repairIntent(text) { return classifyIntent(text).toUpperCase(); }
