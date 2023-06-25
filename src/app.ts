import cluster from "cluster";
import { availableParallelism } from 'node:os';
import process from 'node:process';

import D4DataFilter from "./d4DataFilter.js";


// Pretty Simple.
// Enumerate the files we can do something with
// Rip through all files, string replace with the filters N times
// Re-write them.
// Take another pass once we've thrown away the stuff we don't want at all
// Smash together stuff that makes it easier to understand
// Add context
// :tada:

const PREFIX: string = process.env.DF_PREFIX || "df"
const D4DATA_DIR: string = process.env.D4DATA_DIR || "../d4data"
const DEBUG_MODE: boolean = (process.env.DEBUG === "1") || false

const numCPUs = availableParallelism();

if (cluster.isPrimary) {
  const d4DataFilter = new D4DataFilter(PREFIX, D4DATA_DIR, DEBUG_MODE);
  const files = await d4DataFilter.fileList();
  const workerChunks: string[][] = Array.from({length: numCPUs}).map((e, idx) => []);

  // Stripe the files instead of serially chunking them. The later files tend to take longer to process for some reason.
  // This keeps the cores hot.
  for(let i = 0; i < files.length; i++) {
    const workerIdx = i % workerChunks.length;
    workerChunks[workerIdx].push(files[i]);
  }

  let filesProcessed = 0;
  let workersAlive = numCPUs;
  for(let i = 0; i < numCPUs; i++) {
    const worker = cluster.fork();
    worker.on('message', function(msg: any) {
      if (msg && msg === 'ready') {
        // Workers are 1-indexed :facepalm:
        worker.send({cmd: "fileList", files: workerChunks[worker.id - 1]})
      }

      if (msg.cmd && msg.cmd === 'fileProcessed') {
        filesProcessed += 1;
        if (filesProcessed % 1000 === 0) {
          console.log(`Processed ${filesProcessed}/${files.length} (${Math.round((filesProcessed/(files.length*1.0))*100)}%)`)
        }
      }
    })

    worker.on('exit', (code, signal) => {
      console.log(`Worker #${worker.id} (PID ${worker.process.pid}) exited with code ${code} (${signal})`);
      workersAlive -= 1;
    });
  }
} else if (cluster.isWorker) {
  console.log(`Worker ID #${cluster.worker?.id} (PID ${process.pid}) awaiting files`);
  const d4DataFilter = new D4DataFilter(PREFIX, D4DATA_DIR, DEBUG_MODE);

  process.on('message', async (msg: any) => {
    if(msg && msg.cmd === "fileList") {
      d4DataFilter.filesToProcess.push(...msg.files);
      try {
        await d4DataFilter.process();
        process.exit(0);
      } catch(e: any) {
        console.log(e);
        process.exit(1);
      }
    }
  });
  process.send!("ready");
}

