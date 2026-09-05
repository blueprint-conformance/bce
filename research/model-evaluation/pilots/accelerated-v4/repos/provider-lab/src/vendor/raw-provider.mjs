export const summarizeThroughGateway = (name) => `summary:${String(name).trim()}`;
export const classifyThroughGateway = (text) => String(text).trim().length > 4 ? 'long' : 'short';
export const embedThroughGateway = (text) => [String(text).trim().length, 1];
