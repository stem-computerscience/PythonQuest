#!/usr/bin/env node
// One-time teacher bootstrap. No credentials are saved to disk.
const readline = require("node:readline");
const {stdin,stdout} = require("node:process");
const rl=readline.createInterface({input:stdin,output:stdout});
const ask=q=>new Promise(resolve=>rl.question(q,resolve));
(async()=>{
 try{
  const username=(await ask("Teacher username (3–32 letters, numbers, _ or -): ")).trim();
  const password=await ask("Teacher password (12+ characters; input visible): ");
  const secret=await ask("Cloudflare SETUP_SECRET (input visible): ");
  const url="https://pythonquest-api.dddn28wb5d.workers.dev/api/setup";
  const res=await fetch(url,{method:"POST",headers:{"content-type":"application/json","x-setup-secret":secret},body:JSON.stringify({username,password})});
  const body=await res.json();
  if(!res.ok){console.error("Setup failed:",body.error||res.status);process.exitCode=1;}
  else console.log("Teacher account created:",body.username,"— remove SETUP_SECRET from the Worker now.");
 }catch(e){console.error("Setup failed:",e.message);process.exitCode=1;}finally{rl.close();}
})();
