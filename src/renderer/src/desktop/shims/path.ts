export const join = (...a: string[]) => a.filter(Boolean).join('/')
export const dirname = (p: string) => p.split('/').slice(0, -1).join('/')
export default { join, dirname }
