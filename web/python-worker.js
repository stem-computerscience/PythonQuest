// Runs Python in a separate browser worker.
let pyodide;
self.onmessage = async event => {
 const {code}=event.data;
 try {
  if(!pyodide){importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js');pyodide=await loadPyodide();}
  const actions=[];const output=[];
  pyodide.setStdout({batched:s=>output.push(s)});
  pyodide.setStderr({batched:s=>output.push(s)});
  pyodide.globals.set('game_action',action=>{if(actions.length>=100)throw Error('Too many game actions');actions.push(String(action));});
  const prefix=`def move_forward():\n    game_action('forward')\ndef turn_left():\n    game_action('left')\ndef turn_right():\n    game_action('right')\ndef attack():\n    game_action('attack')\n`;
  await pyodide.runPythonAsync(prefix+'\n'+code);
  self.postMessage({ok:true,actions,output:output.join('\n')});
 }catch(err){self.postMessage({ok:false,error:String(err),actions:[],output:''});}
};
