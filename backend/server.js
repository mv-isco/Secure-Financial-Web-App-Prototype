'use strict';
const config=require('./config');
const {createApp}=require('./app');
function start(){
 const app=createApp(),store=app.locals.store;
 const stopMail=require('./services/mailService').startMailDispatcher(store);
 const maintenance=setInterval(()=>{try{store.cleanup();}catch{console.error('Database maintenance failed.');}},60000);maintenance.unref();
 const server=app.listen(config.port,()=>console.log('SecureVault API listening on port '+config.port));
 let stopping=false;
 function stop(code=0){
  if(stopping)return;stopping=true;clearInterval(maintenance);
  const deadline=setTimeout(()=>process.exit(1),45000);deadline.unref();
  const mailStopped=stopMail();
  server.close(async()=>{try{await mailStopped;store.close();clearTimeout(deadline);process.exit(code);}catch{process.exit(1);}});
  server.closeIdleConnections();
 }
 process.once('SIGTERM',()=>stop());process.once('SIGINT',()=>stop());
 const fatal=event=>()=>{console.error(JSON.stringify({event}));stop(1);};
 process.once('uncaughtException',fatal('uncaught_exception'));process.once('unhandledRejection',fatal('unhandled_rejection'));
 return server;
}
if(require.main===module) start();
module.exports={start,createApp};
