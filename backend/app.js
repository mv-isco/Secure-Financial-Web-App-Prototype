'use strict';
const express=require('express');
const helmet=require('helmet');
const cors=require('cors');
const cookies=require('cookie-parser');
const path=require('node:path');
const fs=require('node:fs');
const config=require('./config');
const {createStore}=require('./store/database');
const authenticate=require('./middleware/authenticate');
const limiter=require('./middleware/rateLimiter');
const {paginationRules}=require('./middleware/validate');
const R=require('./utils/apiResponse');
function createApp({store=createStore(),rateLimit=true,staticDir=path.resolve(__dirname,'../frontend/dist')}={}) {
 if(!rateLimit&&!config.isTest) throw new Error('Rate limits can only be disabled in tests.');
 const app=express(); app.locals.store=store;app.locals.rateLimit=rateLimit;
 const metrics={requests:0,serverErrors:0};
 app.use((req,res,next)=>{metrics.requests++;res.once('finish',()=>{if(res.statusCode>=500)metrics.serverErrors++;});next();});
 app.disable('x-powered-by'); app.set('trust proxy',config.trustProxy);
 app.use(helmet({frameguard:{action:'deny'},hsts:config.isProd?undefined:false,contentSecurityPolicy:{directives:{
  defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],fontSrc:["'self'"],
  imgSrc:["'self'",'data:'],connectSrc:["'self'"],frameAncestors:["'none'"],formAction:["'self'"],
  upgradeInsecureRequests:config.isProd?[]:null,
 }}}));
 app.use(cors({credentials:true,origin:(origin,cb)=>!origin||config.cors.origins.includes(origin)?cb(null,true):cb(Object.assign(new Error('Untrusted origin.'),{status:403}))}));
 app.use(express.json({limit:'10kb',strict:true}));app.use(cookies());
 app.use('/api',limiter('general',100));
 app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
 app.get('/health',(req,res)=>res.json({status:'ok'}));
 app.get('/ready',(req,res)=>{res.set('Cache-Control','no-store');try{store.assertReady();res.json({status:'ready'});}catch{res.status(503).json({status:'unavailable'});}});
 app.use('/api/auth',require('./routes/auth')(store));
 app.use('/api/accounts',require('./routes/accounts')(store));
 app.use('/api/profile',require('./routes/profile')(store));
 app.use('/api/transactions',require('./routes/transactions')(store));
 app.get('/api/audit',authenticate,paginationRules,(req,res)=>R.ok(res,{records:store.auditRecords(req.user.id,Number(req.query.limit||20),Number(req.query.offset||0))}));
 app.get('/api/metrics',authenticate,(req,res)=>req.user.role==='admin'?R.ok(res,{...metrics,uptimeSeconds:Math.floor(process.uptime()),residentBytes:process.memoryUsage().rss}):R.forbidden(res));
 app.use('/api',(req,res)=>R.notFound(res));
 if(fs.existsSync(staticDir)){
  app.use(express.static(staticDir,{index:false}));
  app.get('/{*path}',(req,res)=>path.extname(req.path)?R.notFound(res):res.sendFile(path.join(staticDir,'index.html')));
 }
 app.use((req,res)=>R.notFound(res));
 app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  const status=Number.isInteger(err.status)&&err.status>=400&&err.status<500?err.status:500;
  if(status===500) console.error(JSON.stringify({event:'server_error',code:err.code||'internal'}));
  res.status(status).json({success:false,message:status===413?'Request body too large.':status===400?'Malformed request.':status===403?'Untrusted origin.':status===415?'Unsupported request encoding.':status<500?'Request rejected.':'An unexpected error occurred.'});
 });
 return app;
}
module.exports={createApp};
