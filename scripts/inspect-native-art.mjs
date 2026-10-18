/** Inspect native PNG pixels with nearest-neighbor enlargement; never modifies source art. */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

const [source, target, factorText = '8'] = process.argv.slice(2);
const factor = Number(factorText);
if (!source || !target || !Number.isInteger(factor) || factor < 1) throw new Error('Expected source.png target.png integerScale');
const input = PNG.sync.read(readFileSync(source));
const output = new PNG({ width: input.width * factor, height: input.height * factor });
for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
  const from = (Math.floor(y / factor) * input.width + Math.floor(x / factor)) * 4;
  const to = (y * output.width + x) * 4;
  input.data.copy(output.data, to, from, from + 4);
}
writeFileSync(target, PNG.sync.write(output));
console.log(`${input.width}×${input.height} → ${output.width}×${output.height}`);
