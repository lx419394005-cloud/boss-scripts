export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const jitter = (base, range = 800) => base + Math.floor(Math.random() * range);

export function gaussianJitter(base, standardDeviation = 600, minimum = 0) {
  const u1 = Math.max(Math.random(), Number.EPSILON);
  const u2 = Math.max(Math.random(), Number.EPSILON);
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(minimum, Math.round(base + normal * standardDeviation));
}

export function writeLine(message = '') {
  process.stdout.write(`${message}\n`);
}

export function writeError(message) {
  process.stderr.write(`${message}\n`);
}
