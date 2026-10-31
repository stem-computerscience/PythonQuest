const json=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8",...extra}});
const bytes=s=>new TextEncoder().encode(s);
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("");
const random=()=>crypto.randomUUID();
async function digest(s){return hex(await crypto.subtle.digest("SHA-256",bytes(s)));}
async function hashPassword(password,salt){const key=await crypto.subtle.importKey("raw",bytes(password),"PBKDF2",false,["deriveBits"]);return hex(await crypto.subtle.deriveBits({name:"PBKDF2",salt:bytes(salt),iterations:100000,hash:"SHA-256"},key,256));}
async function verify(password,user){return (await hashPassword(password,user.salt))===user.password_hash;}
async function parse(request){try{return await request.json()}catch{return {}}}
const badgeKeys=p=>{const keys=[];if((Number(p.mission)||1)>=2)keys.push("first");if((Number(p.mission)||1)>=5)keys.push("boss");for(const n of p.skills||[])if(Number.isInteger(n)&&n>=1&&n<=6)keys.push("skill"+n);return keys;};
const stampBadges=(p,previous)=>{const old=new Set(badgeKeys(previous||{}));p.badgeDates={...(previous?.badgeDates||{})};const now=new Date().toISOString();for(const key of badgeKeys(p))if(!old.has(key)&&!p.badgeDates[key])p.badgeDates[key]=now;return p;};
const appendBadgeEvent=(p,event)=>{p.badgeEvents=Array.isArray(p.badgeEvents)?p.badgeEvents:[];p.badgeEvents.push({id:random(),at:new Date().toISOString(),...event});return p;};
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
if(path==="/api/attempts"&&request.method==="POST"){
 if(user.role!=="student")return reply({error:"Student only"},403);
 const b=await parse(request);
 if(typeof b.code!=="string"||b.code.length>12000||!["space","dungeon"].includes(b.world)||!["hybrid","code","terminal"].includes(b.mode)||!Number.isInteger(b.mission)||b.mission<1||b.mission>6||typeof b.output!=="string"||b.output.length>4000||typeof b.success!=="boolean")return reply({error:"Invalid attempt"},400);
 const id=random(),evidence=b.evidence&&typeof b.evidence==="object"?{conceptOk:b.evidence.conceptOk===true,valueOk:b.evidence.valueOk===true}:null;
 await env.DB.prepare("INSERT INTO attempts(id,user_id,mission,world,mode,code,output,success,evidence) VALUES(?,?,?,?,?,?,?,?,?)").bind(id,user.id,b.mission,b.world,b.mode,b.code,b.output,b.success?1:0,JSON.stringify({...evidence})).run();
 return reply({ok:true,id},201);
}
const attemptsMatch=path.match(/^\/api\/students\/([a-f0-9-]{36})\/attempts$/i);
if(attemptsMatch&&request.method==="GET"){
 if(user.role!=="teacher")return reply({error:"Teacher only"},403);
 const student=await env.DB.prepare("SELECT id,username FROM users WHERE id=? AND role='student'").bind(attemptsMatch[1]).first();
 if(!student)return reply({error:"Student not found"},404);
 const rows=await env.DB.prepare("SELECT id,mission,world,mode,code,output,success,evidence,created_at FROM attempts WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100").bind(student.id).all();
 return reply({student:student.username,attempts:rows.results.map(x=>({...x,success:!!x.success,evidence:JSON.parse(x.evidence||"null")}))});
}
if(path==="/api/teacher/flagged-attempts"&&request.method==="GET"){
 if(user.role!=="teacher")return reply({error:"Teacher only"},403);
 const rows=await env.DB.prepare("SELECT attempts.id,attempts.user_id,users.username,attempts.mission,attempts.mode,attempts.success,attempts.evidence,attempts.created_at FROM attempts JOIN users ON users.id=attempts.user_id WHERE users.role='student' ORDER BY attempts.created_at DESC LIMIT 300").all();
 const flagged=rows.results.filter(a=>{let e={};try{e=JSON.parse(a.evidence||"{}")}catch{}return a.success===0;}).slice(0,100).map(a=>({id:a.id,username:a.username,mission:a.mission,mode:a.mode,created_at:a.created_at,reason:"Practice attempt needs help"}));
 return reply({flagged});
}
const submitBoss=path.match(/^\/api\/attempts\/([a-f0-9-]{36})\/submit-boss$/i);
if(submitBoss&&request.method==="POST"){
 if(user.role!=="student")return reply({error:"Student only"},403);
 const row=await env.DB.prepare("SELECT id,mission,evidence FROM attempts WHERE id=? AND user_id=?").bind(submitBoss[1],user.id).first();
 if(!row||row.mission!==4)return reply({error:"Boss attempt not found"},404);
 let evidence={};try{evidence=JSON.parse(row.evidence||"{}")}catch{}
 if(evidence.submittedBossAt)return reply({ok:true,alreadySubmitted:true});
 evidence.submittedBossAt=new Date().toISOString();
 await env.DB.prepare("UPDATE attempts SET evidence=? WHERE id=? AND user_id=?").bind(JSON.stringify(evidence),row.id,user.id).run();
 return reply({ok:true});
}
if(path==="/api/boss/submissions"&&request.method==="GET"){
 if(user.role!=="teacher")return reply({error:"Teacher only"},403);
 const rows=await env.DB.prepare("SELECT a.id,a.user_id,u.username,a.mission,a.world,a.mode,a.code,a.output,a.success,a.evidence,a.created_at FROM attempts a JOIN users u ON u.id=a.user_id WHERE a.mission IN (4) AND u.role='student' ORDER BY a.created_at DESC,a.id DESC LIMIT 200").all();
 const submissions=rows.results.map(row=>{let evidence={};try{evidence=JSON.parse(row.evidence||"{}")}catch{}return {...row,success:!!row.success,evidence,status:evidence.clubAcknowledgment?.complete||evidence.teacherApproval?.approved?"complete":evidence.submittedBossAt?(row.success?"practice-complete":"needs-help"):"draft"};});
 const submitted=submissions.filter(s=>s.status!=="draft");return reply({submissions:submitted,pendingCount:submitted.filter(s=>s.status==="needs-help").length});
}
if(path==="/api/boss/feedback"&&request.method==="GET"){
 if(user.role!=="student")return reply({error:"Student only"},403);
 const rows=await env.DB.prepare("SELECT mission,success,evidence,created_at FROM attempts WHERE user_id=? AND mission=4 ORDER BY created_at DESC,id DESC LIMIT 100").bind(user.id).all();
 const projects=rows.results.flatMap(row=>{let e={};try{e=JSON.parse(row.evidence||"{}")}catch{}return e.submittedBossAt?[{mission:row.mission,created_at:row.created_at,complete:!!row.success||e.clubAcknowledgment?.complete===true||e.teacherApproval?.approved===true,advisorNote:e.clubAcknowledgment?.note||"",submittedAt:e.submittedBossAt}]:[];});
 return reply({projects});
}
const acknowledgeMatch=path.match(/^\/api\/attempts\/([a-f0-9-]{36})\/acknowledge$/i);
if(acknowledgeMatch&&request.method==="POST"){
 if(user.role!=="teacher")return reply({error:"Advisor only"},403);
 const b=await parse(request);
 if(typeof b.note!=="string"||b.note.length>2000)return reply({error:"Invalid note"},400);
 const record=await env.DB.prepare("SELECT mission,evidence FROM attempts WHERE id=?").bind(acknowledgeMatch[1]).first();
 if(!record||record.mission!==4)return reply({error:"Boss project not found"},404);
 let evidence={};try{evidence=JSON.parse(record.evidence||"{}")}catch{}
 if(!evidence.submittedBossAt)return reply({error:"Project has not been submitted"},400);
 evidence.clubAcknowledgment={complete:true,note:b.note.trim(),advisorId:user.id,at:new Date().toISOString()};
 await env.DB.prepare("UPDATE attempts SET evidence=? WHERE id=?").bind(JSON.stringify(evidence),acknowledgeMatch[1]).run();
 return reply({ok:true,acknowledgment:evidence.clubAcknowledgment});
}
const deleteAttempt=path.match(/^\/api\/attempts\/([a-f0-9-]{36})\/delete$/i);
if(deleteAttempt&&request.method==="POST"){
 if(user.role!=="teacher")return reply({error:"Teacher only"},403);
 const result=await env.DB.prepare("DELETE FROM attempts WHERE id=?").bind(deleteAttempt[1]).run();
 return reply({ok:true,deleted:result.meta?.changes||0});
}
if(path==="/api/progress"&&request.method==="GET"){const row=await env.DB.prepare("SELECT data,updated_at FROM saves WHERE user_id=?").bind(user.id).first();return reply({progress:row?JSON.parse(row.data):null,updated_at:row?.updated_at||null});}
const safeNickname=s=>typeof s==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9 _-]{2,19}$/.test(s);
if(path==="/api/leaderboard/nickname"&&request.method==="POST"){
 if(user.role!=="student")return reply({error:"Student only"},403);
 const b=await parse(request),nickname=String(b.nickname||"").trim();
 if(!safeNickname(nickname))return reply({error:"Use 3–20 letters, numbers, spaces, hyphens or underscores."},400);
 const saved=await env.DB.prepare("SELECT data FROM saves WHERE user_id=?").bind(user.id).first();
 let p={};try{p=JSON.parse(saved?.data||"{}")}catch{}
 p.leaderboardNicknamePending=nickname;
 await env.DB.prepare("INSERT INTO saves(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=CURRENT_TIMESTAMP").bind(user.id,JSON.stringify(p)).run();
 return reply({ok:true,pending:true});
}
if(path==="/api/leaderboard/nicknames"&&request.method==="GET"){
 if(user.role!=="teacher")return reply({error:"Advisor only"},403);
 const rows=await env.DB.prepare("SELECT u.id,u.username,s.data FROM users u JOIN saves s ON s.user_id=u.id WHERE u.role='student'").all();
 return reply({requests:rows.results.flatMap(row=>{let p={};try{p=JSON.parse(row.data||"{}")}catch{}return p.leaderboardNicknamePending?[{id:row.id,username:row.username,nickname:p.leaderboardNicknamePending}]:[];})});
}
const nicknameReview=path.match(/^\/api\/leaderboard\/nicknames\/([a-f0-9-]{36})\/review$/i);
if(nicknameReview&&request.method==="POST"){
 if(user.role!=="teacher")return reply({error:"Advisor only"},403);
 const b=await parse(request);if(typeof b.approve!=="boolean")return reply({error:"Invalid decision"},400);
 const saved=await env.DB.prepare("SELECT saves.data FROM saves JOIN users ON users.id=saves.user_id WHERE saves.user_id=? AND users.role='student'").bind(nicknameReview[1]).first();
 if(!saved)return reply({error:"Student not found"},404);
 let p={};try{p=JSON.parse(saved.data||"{}")}catch{}
 if(!p.leaderboardNicknamePending)return reply({error:"No pending nickname"},400);
 if(b.approve){const name=p.leaderboardNicknamePending;const all=await env.DB.prepare("SELECT data FROM saves WHERE user_id<>?").bind(nicknameReview[1]).all();const taken=all.results.some(row=>{try{return JSON.parse(row.data||"{}").leaderboardNickname?.toLowerCase()===name.toLowerCase()}catch{return false}});if(taken)return reply({error:"Nickname already in use"},409);p.leaderboardNickname=name;}
 delete p.leaderboardNicknamePending;
 await env.DB.prepare("UPDATE saves SET data=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?").bind(JSON.stringify(p),nicknameReview[1]).run();
 return reply({ok:true,approved:b.approve});
}
const CLUB_AWARD_IDS=["mentor","teamwork","creativity","debugger"];
const validBadgeId=(id,defs)=>CLUB_AWARD_IDS.includes(id)||(typeof id==="string"&&Array.isArray(defs)&&defs.some(d=>d.id===id));
const badgeCatalog=async env=>{const row=await env.DB.prepare("SELECT data FROM saves WHERE user_id=?").bind("club:badge-catalog").first();let defs=[];try{defs=JSON.parse(row?.data||"[]")}catch{}return Array.isArray(defs)?defs:[];};
if(path==="/api/club/badges/catalog"&&request.method==="GET"){return reply({badges:await badgeCatalog(env)});}
if(path==="/api/club/badges/catalog"&&request.method==="POST"){
 if(user.role!=="teacher")return reply({error:"Advisor only"},403);
 const b=await parse(request);
 if(typeof b.name!=="string"||b.name.trim().length<3||b.name.trim().length>48||typeof b.description!=="string"||b.description.length>180||typeof b.icon!=="string"||!["star","rocket","shield","lightbulb","trophy","heart","code"].includes(b.icon))return reply({error:"Invalid badge details"},400);
 const defs=await badgeCatalog(env);if(defs.length>=40)return reply({error:"Badge catalog full"},400);
 const badge={id:"custom:"+random(),name:b.name.trim(),description:b.description.trim(),icon:b.icon,createdAt:new Date().toISOString()};
 defs.push(badge);
 await env.DB.prepare("INSERT INTO saves(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data").bind("club:badge-catalog",JSON.stringify(defs)).run();
 return reply({badge},201);
}

if(path==="/api/club/badges/award"&&request.method==="POST"){
 if(user.role!=="teacher")return reply({error:"Advisor only"},403);
 const b=await parse(request);
 if(typeof b.studentId!=="string"||!validBadgeId(b.badge,await badgeCatalog(env)))return reply({error:"Invalid award"},400);
 const row=await env.DB.prepare("SELECT s.data FROM saves s JOIN users u ON u.id=s.user_id WHERE u.id=? AND u.role='student'").bind(b.studentId).first();
 if(!row)return reply({error:"Student not found"},404);
 let p={};try{p=JSON.parse(row.data||"{}")}catch{}
 p.clubAwards=Array.isArray(p.clubAwards)?p.clubAwards:[];
 if(!p.clubAwards.includes(b.badge)){p.clubAwards.push(b.badge);p.clubAwardDates={...(p.clubAwardDates||{}),[b.badge]:new Date().toISOString()};appendBadgeEvent(p,{action:"awarded",badge:b.badge,advisor:user.id});}
 await env.DB.prepare("UPDATE saves SET data=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?").bind(JSON.stringify(p),b.studentId).run();
 return reply({ok:true,awards:p.clubAwards});
}
if(path==="/api/club/badges/remove"&&request.method==="POST"){
 if(user.role!=="teacher")return reply({error:"Advisor only"},403);
 const b=await parse(request);
 if(!validBadgeId(b.badge,await badgeCatalog(env))||typeof b.studentId!=="string")return reply({error:"Invalid request"},400);
 const row=await env.DB.prepare("SELECT data FROM saves WHERE user_id=?").bind(b.studentId).first();
 if(!row)return reply({error:"No saved student"},404);
 let p={};try{p=JSON.parse(row.data)}catch{}
 const hadBadge=Array.isArray(p.clubAwards)&&p.clubAwards.includes(b.badge);p.clubAwards=(p.clubAwards||[]).filter(x=>x!==b.badge);if(p.clubAwardDates)delete p.clubAwardDates[b.badge];if(hadBadge)appendBadgeEvent(p,{action:"removed",badge:b.badge,advisor:user.id});
 await env.DB.prepare("UPDATE saves SET data=? WHERE user_id=?").bind(JSON.stringify(p),b.studentId).run();
 return reply({ok:true});
}
if(path==="/api/club/achievements"&&request.method==="GET"){
 if(user.role!=="student")return reply({error:"Student only"},403);
 const row=await env.DB.prepare("SELECT data FROM saves WHERE user_id=?").bind(user.id).first();let p={};try{p=JSON.parse(row?.data||"{}")}catch{}
 return reply({badges:badgeKeys(p),dates:p.badgeDates||{},special:p.clubAwards||[],specialDates:p.clubAwardDates||{}});
}
if(path==="/api/club/achievements/notifications"&&request.method==="POST"){
 if(user.role!=="student")return reply({error:"Student only"},403);
 const row=await env.DB.prepare("SELECT data FROM saves WHERE user_id=?").bind(user.id).first();let p={};try{p=JSON.parse(row?.data||"{}")}catch{}
 const earned=[...badgeKeys(p),...(p.clubAwards||[]).map(x=>"special:"+x)];
 const seen=new Set(Array.isArray(p.badgeNotified)?p.badgeNotified:[]);
 const fresh=earned.filter(x=>!seen.has(x));
 p.badgeNotified=[...new Set([...seen,...earned])];
 await env.DB.prepare("INSERT INTO saves(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data").bind(user.id,JSON.stringify(p)).run();
 return reply({newBadges:fresh});
}
if(path==="/api/club/achievements/history"&&request.method==="GET"){
 if(user.role!=="teacher")return reply({error:"Advisor only"},403);
 const rows=await env.DB.prepare("SELECT u.username,s.data FROM users u JOIN saves s ON s.user_id=u.id WHERE u.role='student'").all();
 const history=rows.results.flatMap(row=>{let p={};try{p=JSON.parse(row.data||"{}")}catch{}return (p.badgeEvents||[]).map(e=>({...e,username:row.username}));});
 history.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
 return reply({history:history.slice(0,500)});
}
if(path==="/api/club/badges"&&request.method==="GET"){
 const rows=await env.DB.prepare("SELECT u.id,u.username,s.data FROM users u JOIN saves s ON s.user_id=u.id WHERE u.role='student' AND u.active=1").all();
 const members=rows.results.map(row=>{let p={};try{p=JSON.parse(row.data||"{}")}catch{}return {id:row.id,name:p.leaderboardOptIn===true&&safeNickname(p.leaderboardNickname)?p.leaderboardNickname:null,skills:Array.isArray(p.skills)?p.skills:[],chapter:Number(p.mission)||1,awards:Array.isArray(p.clubAwards)?p.clubAwards:[],awardDates:p.clubAwardDates||{}};}).filter(x=>x.name);
 return reply({members});
}
if(path==="/api/leaderboard/opt-in"&&request.method==="POST"){
 if(user.role!=="student")return reply({error:"Student only"},403);
 const body=await parse(request);if(typeof body.optIn!=="boolean")return reply({error:"optIn must be boolean"},400);
 const saved=await env.DB.prepare("SELECT data FROM saves WHERE user_id=?").bind(user.id).first();
 let progress={};try{progress=saved?JSON.parse(saved.data):{}}catch{}
 progress.leaderboardOptIn=body.optIn;
 await env.DB.prepare("INSERT INTO saves(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=CURRENT_TIMESTAMP").bind(user.id,JSON.stringify(progress)).run();
 return reply({ok:true,optIn:body.optIn});
}
if(path==="/api/leaderboard"&&request.method==="GET"){
 if(user.role!=="student"&&user.role!=="teacher")return reply({error:"Unauthorized"},403);
 const rows=await env.DB.prepare("SELECT u.username,s.data FROM users u JOIN saves s ON s.user_id=u.id WHERE u.role='student' AND u.active=1").all();
 const players=rows.results.flatMap(row=>{let p={};try{p=JSON.parse(row.data||"{}")}catch{}return p.leaderboardOptIn===true&&safeNickname(p.leaderboardNickname)?[{nickname:p.leaderboardNickname,chapter:Math.max(1,Math.min(6,Number(p.mission)||1)),xp:Math.max(0,Math.min(600,Number(p.xp)||0))}]:[];});
 players.sort((a,b)=>b.xp-a.xp||b.chapter-a.chapter||a.nickname.localeCompare(b.nickname));
 return reply({players:players.slice(0,50)});
}
if(path==="/api/progress"&&request.method==="POST"){if(user.role!=="student")return reply({error:"Student only"},403);const b=await parse(request);if(!b||typeof b!=="object"||Array.isArray(b)||JSON.stringify(b).length>16000)return reply({error:"Invalid progress"},400);const existing=await env.DB.prepare("SELECT data FROM saves WHERE user_id=?").bind(user.id).first();let previous={};try{previous=existing?JSON.parse(existing.data):{}}catch{}const requestedMission=Math.max(1,Math.min(6,Number(b.mission)||1));const previousMission=Math.max(1,Math.min(6,Number(previous.mission)||1));if(requestedMission>previousMission){
 if(requestedMission!==previousMission+1)return reply({error:"Complete one mission at a time."},403);
 const records=await env.DB.prepare("SELECT success,evidence FROM attempts WHERE user_id=? AND mission=?").bind(user.id,previousMission).all();
 const boss=previousMission%4===0;
 const allowed=records.results.some(row=>{let e={};try{e=JSON.parse(row.evidence||"{}")}catch{}return boss?((!!e.submittedBossAt&&(row.success===1||e.clubAcknowledgment?.complete===true))||(e.teacherApproval?.approved===true)):row.success===1;});
 if(!allowed)return reply({error:boss?"Complete the boss project through practice checks or advisor acknowledgment.":"Complete the practice challenge before advancing."},403);
}const progress={world:["space","dungeon"].includes(b.world)?b.world:"space",mission:requestedMission,xp:Math.max(0,Math.min(100000,Number(b.xp)||0)),defaultMode:["hybrid","code","terminal"].includes(previous.defaultMode)?previous.defaultMode:"hybrid",skills:Array.isArray(previous.skills)?previous.skills.filter(x=>Number.isInteger(x)&&x>=1&&x<=6):[],releasedRegion:Math.max(1,Math.min(2,Number(previous.releasedRegion)||Math.ceil((Number(previous.mission)||1)/4))),leaderboardOptIn:previous.leaderboardOptIn===true,leaderboardNickname:previous.leaderboardNickname||null,leaderboardNicknamePending:previous.leaderboardNicknamePending||null,clubAwards:Array.isArray(previous.clubAwards)?previous.clubAwards:[],clubAwardDates:previous.clubAwardDates||{},badgeDates:previous.badgeDates||{},badgeEvents:previous.badgeEvents||[],badgeNotified:previous.badgeNotified||[]};stampBadges(progress,previous);if(progress.mission>progress.releasedRegion*4)return reply({error:"This region has not been released by your teacher"},403);await env.DB.prepare("INSERT INTO saves(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=CURRENT_TIMESTAMP").bind(user.id,JSON.stringify(progress)).run();return reply({ok:true,progress});}
if(path==="/api/skills/complete"&&request.method==="POST"){
 if(user.role!=="student")return reply({error:"Student only"},403);
 const b=await parse(request),skill=Number(b.skill);
 if(!Number.isInteger(skill)||skill<1||skill>6)return reply({error:"Invalid skill"},400);
 const saved=await env.DB.prepare("SELECT data FROM saves WHERE user_id=?").bind(user.id).first();
 let old={};try{old=saved?JSON.parse(saved.data):{}}catch{}
 const skills=[...new Set([...(Array.isArray(old.skills)?old.skills:[]),skill])].filter(x=>Number.isInteger(x)&&x>=1&&x<=6).sort((a,b)=>a-b);
 const progress={...old,world:old.world==="dungeon"?"dungeon":"space",mission:Math.max(1,Math.min(6,Number(old.mission)||1)),xp:Math.max(0,Math.min(100000,Number(old.xp)||0)),defaultMode:["hybrid","code","terminal"].includes(old.defaultMode)?old.defaultMode:"hybrid",skills,releasedRegion:Math.max(1,Math.min(2,Number(old.releasedRegion)||Math.ceil((Number(old.mission)||1)/4)))};stampBadges(progress,old);
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
 const progress={...old,world:old.world==="dungeon"?"dungeon":"space",mission,xp:b.resetXp?0:Math.max(0,Math.min(100000,Number(old.xp)||0)),defaultMode:["hybrid","code","terminal"].includes(old.defaultMode)?old.defaultMode:"hybrid",skills:Array.isArray(old.skills)?old.skills.filter(x=>Number.isInteger(x)&&x>=1&&x<=6):[],releasedRegion:Math.max(Math.ceil(mission/4),Math.max(1,Math.min(2,Number(old.releasedRegion)||Math.ceil((Number(old.mission)||1)/4))))};
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
 const progress={...old,world:old.world==="dungeon"?"dungeon":"space",mission:Math.max(1,Math.min(6,Number(old.mission)||1)),xp:Math.max(0,Math.min(100000,Number(old.xp)||0)),defaultMode:["hybrid","code","terminal"].includes(old.defaultMode)?old.defaultMode:"hybrid",skills:Array.isArray(old.skills)?old.skills.filter(x=>Number.isInteger(x)&&x>=1&&x<=6):[],releasedRegion:Math.max(region,Math.ceil((Number(old.mission)||1)/4))};
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
 const progress={...old,world:old.world==="dungeon"?"dungeon":"space",mission:Math.max(1,Math.min(6,Number(old.mission)||1)),xp:Math.max(0,Math.min(100000,Number(old.xp)||0)),defaultMode:b.mode};
 await env.DB.prepare("INSERT INTO saves(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=CURRENT_TIMESTAMP").bind(student.id,JSON.stringify(progress)).run();
 return reply({ok:true,progress});
}
const match=path.match(/^\/api\/students\/([a-f0-9-]{36})\/(password|active)$/i);if(match&&request.method==="POST"){const b=await parse(request);if(match[2]==="password"){if(!validPass(b.password))return reply({error:"Password must be at least 12 characters"},400);const salt=random();await env.DB.prepare("UPDATE users SET password_hash=?,salt=? WHERE id=? AND role='student'").bind(await hashPassword(b.password,salt),salt,match[1]).run();}else{if(typeof b.active!=="boolean")return reply({error:"Invalid active state"},400);await env.DB.prepare("UPDATE users SET active=? WHERE id=? AND role='student'").bind(b.active?1:0,match[1]).run();}await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(match[1]).run();return reply({ok:true});}
return reply({error:"Not found"},404);
}catch(e){console.error("PythonQuest API error",{stage,errorName:e?.name||"Error",errorMessage:String(e?.message||"Unknown error").slice(0,500)});return reply({error:"Request failed"},500);}}};