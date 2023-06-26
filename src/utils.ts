import fs from 'fs/promises';
import path from 'path';

export async function writeFile(fileName: string, content: string): Promise<void> {
  await createDirectories(fileName);
  try {
    return fs.writeFile(fileName, content, { encoding: 'utf8' });
  } catch(e: any) {
    console.log(`Could not write file '${fileName}': ${e.message}`);
    return;
  }
}

export async function writeJSONFile(fileName: string, content: string): Promise<void> {
  return writeFile(fileName, JSON.stringify(JSON.parse(content), null, 2));
}

export async function createDirectories(fileName: string): Promise<void> {
  const dirName = path.dirname(fileName);
  await fs.mkdir(dirName, { recursive: true });
  return;
}

export default {writeJSONFile, createDirectories};