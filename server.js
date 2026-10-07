import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';

const app = express();
const production = process.env.NODE_ENV === 'production';
const dataDir = process.env.DATA_DIR || './data';
mkdirSync(dataDir, {recursive:true});
const db = new DatabaseSync(path.join(dataDir, 'menu.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,salt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS spaces(id INTEGER PRIMARY KEY,owner INTEGER UNIQUE REFERENCES users(id),slug TEXT UNIQUE,name TEXT,whatsapp TEXT,description TEXT,address TEXT,hours TEXT,published INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,space INTEGER REFERENCES spaces(id),name TEXT,category TEXT,description TEXT,price INTEGER,image TEXT,available INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user INTEGER REFERENCES users(id),expires INTEGER);
CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER,expires INTEGER);`);
app.disable('x-powered-by');
app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"});next();});
app.use(express.json({limit:'32kb'}));
app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');if(!['GET','HEAD'].includes(req.method)&&req.get('origin')&&req.get('origin')!==`${req.protocol}://${req.get('host')}`)return res.status(403).json({error:'Origem inválida.'});next();});
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 0));
const hash = t=>createHash('sha256').update(t).digest('hex');
const clean=(v,max=200)=>String(v??'').trim().slice(0,max);
const safeImage=v=>{try{const u=new URL(v);return u.protocol==='https:'?u.href:'';}catch{return '';}};
function fail(res,message,status=400){return res.status(status).json({error:message});}
function auth(req,res,next){const token=decodeURIComponent((req.headers.cookie||'').split('; ').find(x=>x.startsWith('menu_session='))?.slice(13)||'');const session=db.prepare('SELECT user FROM sessions WHERE token=? AND expires>?').get(hash(token),Date.now());if(!session)return fail(res,'Entra na tua conta para continuar.',401);req.user=session.user;next();}
function session(res,user){const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token),user,Date.now()+7*86400000);res.cookie('menu_session',token,{httpOnly:true,secure:production,sameSite:'lax',maxAge:7*86400000,path:'/'});}
function rate(req,res,next){const key=req.ip;const now=Date.now();db.prepare('DELETE FROM limits WHERE expires<?').run(now);db.prepare('INSERT INTO limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+15*60000);if(db.prepare('SELECT count FROM limits WHERE key=?').get(key).count>20)return fail(res,'Muitas tentativas. Aguarda 15 minutos.',429);next();}
app.post('/api/register',rate,(req,res)=>{const email=clean(req.body.email,254).toLowerCase(),password=String(req.body.password||'');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<10||password.length>128)return fail(res,'Usa um email válido e uma palavra-passe de 10 a 128 caracteres.');const salt=randomBytes(16).toString('hex');try{const result=db.prepare('INSERT INTO users(email,password,salt) VALUES(?,?,?)').run(email,scryptSync(password,salt,64).toString('hex'),salt);session(res,Number(result.lastInsertRowid));res.json({ok:true});}catch(e){if(String(e).includes('UNIQUE'))return fail(res,'Este email já tem uma conta.',409);throw e;}});
app.post('/api/login',rate,(req,res)=>{const user=db.prepare('SELECT * FROM users WHERE email=?').get(clean(req.body.email,254).toLowerCase());const p=String(req.body.password||'');if(p.length>128)return fail(res,'Dados de acesso inválidos.',401);const candidate=scryptSync(p,user?.salt||'dummy-salt',64);if(!user||!timingSafeEqual(candidate,Buffer.from(user.password,'hex')))return fail(res,'Dados de acesso inválidos.',401);session(res,user.id);res.json({ok:true});});
app.post('/api/logout',auth,(req,res)=>{const t=(req.headers.cookie||'').split('; ').find(x=>x.startsWith('menu_session='))?.slice(13)||'';db.prepare('DELETE FROM sessions WHERE token=?').run(hash(t));res.clearCookie('menu_session',{path:'/'});res.json({ok:true});});
app.get('/api/me',auth,(req,res)=>{const user=db.prepare('SELECT email FROM users WHERE id=?').get(req.user);const space=db.prepare('SELECT * FROM spaces WHERE owner=?').get(req.user);res.json({email:user.email,space:space||null,products:space?db.prepare('SELECT * FROM products WHERE space=? ORDER BY id DESC').all(space.id):[]});});
app.put('/api/space',auth,(req,res)=>{const b=req.body,slug=clean(b.slug,60).toLowerCase(),name=clean(b.name,100),whatsapp=clean(b.whatsapp,20).replace(/[\s+()-]/g,'');if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug==='demo'||name.length<2||!/^244\d{9}$/.test(whatsapp))return fail(res,'Preenche o nome, um endereço válido (ex.: sabor-luanda) e WhatsApp com 244 e 9 dígitos.');try{db.prepare(`INSERT INTO spaces(owner,slug,name,whatsapp,description,address,hours,published) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET slug=excluded.slug,name=excluded.name,whatsapp=excluded.whatsapp,description=excluded.description,address=excluded.address,hours=excluded.hours,published=excluded.published`).run(req.user,slug,name,whatsapp,clean(b.description,1000),clean(b.address,200),clean(b.hours,200),b.published?1:0);res.json({ok:true});}catch(e){if(String(e).includes('UNIQUE'))return fail(res,'Este endereço já está ocupado.',409);throw e;}});
app.post('/api/products',auth,(req,res)=>{const space=db.prepare('SELECT id FROM spaces WHERE owner=?').get(req.user);if(!space)return fail(res,'Guarda primeiro o teu espaço.');const b=req.body,price=Number(b.price);if(!clean(b.name,100)||!Number.isSafeInteger(price)||price<0||price>10000000)return fail(res,'Indica um nome e preço válido em Kz.');const values=[clean(b.name,100),clean(b.category,80)||'Menu',clean(b.description,500),price,safeImage(b.image),b.available?1:0];if(b.id){const r=db.prepare('UPDATE products SET name=?,category=?,description=?,price=?,image=?,available=? WHERE id=? AND space=?').run(...values,Number(b.id),space.id);if(!r.changes)return fail(res,'Produto não encontrado.',404);}else db.prepare('INSERT INTO products(name,category,description,price,image,available,space) VALUES(?,?,?,?,?,?,?)').run(...values,space.id);res.json({ok:true});});
app.delete('/api/products/:id',auth,(req,res)=>{const result=db.prepare('DELETE FROM products WHERE id=? AND space IN (SELECT id FROM spaces WHERE owner=?)').run(Number(req.params.id),req.user);if(!result.changes)return fail(res,'Produto não encontrado.',404);res.json({ok:true});});
app.get('/api/menu/:slug',(req,res)=>{const space=db.prepare('SELECT id,slug,name,whatsapp,description,address,hours FROM spaces WHERE slug=? AND published=1').get(req.params.slug);if(!space)return fail(res,'Este menu não está disponível.',404);res.json({space,products:db.prepare('SELECT id,name,category,description,price,image,available FROM products WHERE space=? ORDER BY id').all(space.id)});});
app.get('/api/qr/:slug',async(req,res,next)=>{try{const space=db.prepare('SELECT slug FROM spaces WHERE slug=? AND published=1').get(req.params.slug);if(!space)return fail(res,'Publica primeiro o teu espaço.',404);const origin=process.env.PUBLIC_URL||`${req.protocol}://${req.get('host')}`;res.type('png').send(await QRCode.toBuffer(`${origin}/m/${space.slug}`,{width:1000,margin:3,errorCorrectionLevel:'M'}));}catch(e){next(e);}});
app.get('/api/health',(req,res)=>res.json({ok:true}));
app.use(express.static('public',{maxAge:production?'1h':0}));
app.get(['/','/entrar','/criar-conta','/painel','/demo','/m/:slug','/privacidade','/termos'],(req,res)=>res.sendFile(path.resolve('public/index.html')));
app.use((err,req,res,next)=>{console.error(err.message);res.status(500).json({error:'Não foi possível concluir. Tenta novamente.'});});
app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Menu Online disponível na porta '+(process.env.PORT||3000)));
