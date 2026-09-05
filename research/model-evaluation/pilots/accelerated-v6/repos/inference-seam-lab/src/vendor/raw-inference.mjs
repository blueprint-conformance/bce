export const classifyIntent = (text) => String(text).trim().length > 5 ? 'complex' : 'simple';
export const vectorLabel = (text) => `vector:${String(text).trim().length}`;
