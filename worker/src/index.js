const json=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8",...extra}});
const bytes=s=>new TextEncoder().encode(s);
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("");
const random=()=>crypto.randomUUID();
async function digest(s){return hex(await crypto.subtle.digest("SHA-256",bytes(s)));}
async function hashPassword(password,salt){const key=await crypto.subtle.importKey("raw",bytes(password),"PBKDF2",false,["deriveBits"]);return hex(await crypto.subtle.deriveBits({name:"PBKDF2",salt:bytes(salt),iterations:100000,hash:"SHA-256"},key,256));}
async function verify(password,user){return (await hashPassword(password,user.salt))===user.password_hash;}
async function parse(request){try{return await request.json()}catch{return {}}}
const validName=s=>typeof s==="string"&&/^[a-zA-Z0-9_-]{3,32}$/.test(s);
const validPass=s=>typeof s==="string"&&s.length>=12&&s.length<=128;
async function auth(request,env){const token=request.headers.get("authorization")?.match(/^Bearer ([a-f0-9-]{36})$/i)?.[1];if(!token)return null;const h=await digest(token);return env.DB.prepare("SELECT users.id,users.username,users.role FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>? AND users.active=1").bind(h,Date.now()).first();}
async function createUser(env,username,password,role){const id=random(),salt=random(),passwordHash=await hashPassword(password,salt);await env.DB.prepare("INSERT INTO users(id,username,password_hash,salt,role) VALUES(?,?,?,?,?)").bind(id,username,passwordHash,salt,role).run();return {id,username,role};}
function cors(origin,env){const allowed=(env.ALLOWED_ORIGIN||"").split(",").map(s=>s.trim());return allowed.includes(origin)?{"access-control-allow-origin":origin,"vary":"Origin","access-control-allow-headers":"authorization,content-type,x-setup-secret","access-control-allow-methods":"GET,POST,OPTIONS"}:{};}
export default {async fetch(request,env){const origin=request.headers.get("origin")||"";let stage="request";const headers=cors(origin,env);const reply=(v,s=200)=>json(v,s,headers);if(request.method==="OPTIONS")return new Response(null,{status:204,headers});if(origin&&!headers["access-control-allow-origin"])return reply({error:"Origin not allowed"},403);
try{const url=new URL(request.url),path=url.pathname;
if(path==="/api/health"&&request.method==="GET")return reply({ok:true});
if(path==="/api/setup"&&request.method==="POST"){if(!env.SETUP_SECRET)return reply({error:"Setup disabled"},403);const supplied=request.headers.get("x-setup-secret");if(!supplied||supplied!==env.SETUP_SECRET)return reply({error:"Forbidden"},403);stage="setup:check-existing-teacher";const existing=await env.DB.prepare("SELECT id FROM users WHERE role='teacher' LIMIT 1").first();if(existing)return reply({error:"Teacher already exists"},409);const b=await parse(request);if(!validName(b.username)||!validPass(b.password))return reply({error:"Username must be 3–32 letters/numbers; password at least 12 characters"},400);stage="setup:create-teacher";return reply(await createUser(env,b.username,b.password,"teacher"),201);}
if(path==="/api/login"&&request.method==="POST"){const b=await parse(request);const user=validName(b.username)?await env.DB.prepare("SELECT * FROM users WHERE username=? AND active=1").bind(b.username).first():null;if(!user||typeof b.password!=="string"||!(await verify(b.password,user)))return reply({error:"Invalid credentials"},401);const token=random();await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").bind(await digest(token),user.id,Date.now()+86400000).run();return reply({token,user:{id:user.id,username:user.username,role:user.role}});}
const user=await auth(request,env);if(!user)return reply({error:"Unauthorized"},401);
if(path==="/api/logout"&&request.method==="POST"){const token=request.headers.get("authorization").slice(7);await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digest(token)).run();return reply({ok:true});}
if(path==="/api/me"&&request.method==="GET")return reply({user});
if(path==="/api/progress"&&request.method==="GET"){const row=await env.DB.prepare("SELECT data,updated_at FROM saves WHERE user_id=?").bind(user.id).first();return reply({progress:row?JSON.parse(row.data):null,updated_at:row?.updated_at||null});}
if(path==="/api/progress"&&request.method==="POST"){if(user.role!=="student")return reply({error:"Student only"},403);const b=await parse(request);if(!b||typeof b!=="object"||Array.isArray(b)||JSON.stringify(b).length>16000)return reply({error:"Invalid progress"},400);const existing=await env.DB.prepare("SELECT data FROM saves WHERE user_id=?").bind(user.id).first();let previous={};try{previous=existing?JSON.parse(existing.data):{}}catch{}const progress={world:["space","dungeon"].includes(b.world)?b.world:"space",mission:Math.max(1,Math.min(6,Number(b.mission)||1)),xp:Math.max(0,Math.min(100000,Number(b.xp)||0)),defaultMode:["hybrid","code","terminal"].includes(previous.defaultMode)?previous.defaultMode:"hybrid",skills:Array.isArray(previous.skills)?previous.skills.filter(x=>Number.isInteger(x)&&x>=1&&x<=6):[],releasedRegion:Math.max(1,Math.min(2,Number(previous.releasedRegion)||Math.ceil((Number(previous.mission)||1)/4)))};if(progress.mission>progress.releasedRegion*4)return reply({error:"This region has not been released by your teacher"},403);await env.DB.prepare("INSERT INTO saves(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=CURRENT_TIMESTAMP").bind(user.id,JSON.stringify(progress)).run();return reply({ok:true,progress});}
if(path==="/api/skills/complete"&&request.method==="POST"){
 if(user.role!=="student")return reply({error:"Student only"},403);
 const b=await parse(request),skill=Number(b.skill);
 if(!Number.isInteger(skill)||skill<1||skill>6)return reply({error:"Invalid skill"},400);
 const saved=await env.DB.prepare("SELECT data FROM saves WHERE user_id=?").bind(user.id).first();
 let old={};try{old=saved?JSON.parse(saved.data):{}}catch{}
 const skills=[...new Set([...(Array.isArray(old.skills)?old.skills:[]),skill])].filter(x=>Number.isInteger(x)&&x>=1&&x<=6).sort((a,b)=>a-b);
 const progress={world:old.world==="dungeon"?"dungeon":"space",mission:Math.max(1,Math.min(6,Number(old.mission)||1)),xp:Math.max(0,Math.min(100000,Number(old.xp)||0)),defaultMode:["hybrid","code","terminal"].includes(old.defaultMode)?old.defaultMode:"hybrid",skills,releasedRegion:Math.max(1,Math.min(2,Number(old.releasedRegion)||Math.ceil((Number(old.mission)||1)/4)))};
 await env.DB.prepare("INSERT INTO saves(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=CURRENT_TIMESTAMP").bind(user.id,JSON.stringify(progress)).run();
 return reply({ok:true,skills});
}
if(user.role!=="teacher")return reply({error:"Teacher only"},403);
if(path==="/api/students"&&request.method==="GET"){const rows=await env.DB.prepare("SELECT users.id,users.username,users.active,saves.data,saves.updated_at FROM users LEFT JOIN saves ON saves.user_id=users.id WHERE users.role='student' ORDER BY users.username").all();return reply({students:rows.results.map(x=>({id:x.id,username:x.username,active:!!x.active,progress:x.data?JSON.parse(x.data):null,updated_at:x.updated_at}))});}
if(path==="/api/students"&&request.method==="POST"){const b=await parse(request);if(!validName(b.username)||!validPass(b.password))return reply({error:"Invalid username or password"},400);return reply(await createUser(env,b.username,b.password,"student"),201);}
const placement=path.match(/^\/api\/students\/([a-f0-9-]{36})\/starting-chapter$/i);
if(placement&&request.method==="POST"){
 const b=await parse(request),mission=Number(b.mission);
 if(!Number.isInteger(mission)||mission<1||mission>6||typeof b.resetXp!=="boolean")return reply({error:"Choose a chapter from 1 to 6 and specify whether to reset XP"},400);
 const student=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='student'").bind(placement[1]).first();
 if(!student)return reply({error:"Student not found"},404);
 const saved=await env.DB.prepare("SELECT data FROM saves WHERE user_id=?").bind(student.id).first();
 let old={};try{old=saved?JSON.parse(saved.data):{}}catch{}
 const progress={world:old.world==="dungeon"?"dungeon":"space",mission,xp:b.resetXp?0:Math.max(0,Math.min(100000,Number(old.xp)||0)),defaultMode:["hybrid","code","terminal"].includes(old.defaultMode)?old.defaultMode:"hybrid",skills:Array.isArray(old.skills)?old.skills.filter(x=>Number.isInteger(x)&&x>=1&&x<=6):[],releasedRegion:Math.max(Math.ceil(mission/4),Math.max(1,Math.min(2,Number(old.releasedRegion)||Math.ceil((Number(old.mission)||1)/4))))};
 await env.DB.prepare("INSERT INTO saves(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=CURRENT_TIMESTAMP").bind(student.id,JSON.stringify(progress)).run();
 return reply({ok:true,progress});
}
const releaseMatch=path.match(/^\/api\/students\/([a-f0-9-]{36})\/release-region$/i);
if(releaseMatch&&request.method==="POST"){
 const b=await parse(request),region=Number(b.region);
 if(!Number.isInteger(region)||region<1||region>2)return reply({error:"Only regions 1 and 2 are currently playable"},400);
 const student=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='student'").bind(releaseMatch[1]).first();
 if(!student)return reply({error:"Student not found"},404);
 const saved=await env.DB.prepare("SELECT data FROM saves WHERE user_id=?").bind(student.id).first();
 let old={};try{old=saved?JSON.parse(saved.data):{}}catch{}
 const progress={world:old.world==="dungeon"?"dungeon":"space",mission:Math.max(1,Math.min(6,Number(old.mission)||1)),xp:Math.max(0,Math.min(100000,Number(old.xp)||0)),defaultMode:["hybrid","code","terminal"].includes(old.defaultMode)?old.defaultMode:"hybrid",skills:Array.isArray(old.skills)?old.skills.filter(x=>Number.isInteger(x)&&x>=1&&x<=6):[],releasedRegion:Math.max(region,Math.ceil((Number(old.mission)||1)/4))};
 await env.DB.prepare("INSERT INTO saves(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=CURRENT_TIMESTAMP").bind(student.id,JSON.stringify(progress)).run();
 return reply({ok:true,progress});
}
const modeMatch=path.match(/^\/api\/students\/([a-f0-9-]{36})\/default-mode$/i);
if(modeMatch&&request.method==="POST"){
 const b=await parse(request);
 if(!["hybrid","code","terminal"].includes(b.mode))return reply({error:"Invalid learning mode"},400);
 const student=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='student'").bind(modeMatch[1]).first();
 if(!student)return reply({error:"Student not found"},404);
 const saved=await env.DB.prepare("SELECT data FROM saves WHERE user_id=?").bind(student.id).first();
 let old={};try{old=saved?JSON.parse(saved.data):{}}catch{}
 const progress={world:old.world==="dungeon"?"dungeon":"space",mission:Math.max(1,Math.min(6,Number(old.mission)||1)),xp:Math.max(0,Math.min(100000,Number(old.xp)||0)),defaultMode:b.mode};
 await env.DB.prepare("INSERT INTO saves(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=CURRENT_TIMESTAMP").bind(student.id,JSON.stringify(progress)).run();
 return reply({ok:true,progress});
}
const match=path.match(/^\/api\/students\/([a-f0-9-]{36})\/(password|active)$/i);if(match&&request.method==="POST"){const b=await parse(request);if(match[2]==="password"){if(!validPass(b.password))return reply({error:"Password must be at least 12 characters"},400);const salt=random();await env.DB.prepare("UPDATE users SET password_hash=?,salt=? WHERE id=? AND role='student'").bind(await hashPassword(b.password,salt),salt,match[1]).run();}else{if(typeof b.active!=="boolean")return reply({error:"Invalid active state"},400);await env.DB.prepare("UPDATE users SET active=? WHERE id=? AND role='student'").bind(b.active?1:0,match[1]).run();}await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(match[1]).run();return reply({ok:true});}
return reply({error:"Not found"},404);
}catch(e){console.error("PythonQuest API error",{stage,errorName:e?.name||"Error",errorMessage:String(e?.message||"Unknown error").slice(0,500)});return reply({error:"Request failed"},500);}}};