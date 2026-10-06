'use strict';
const nodemailer=require('nodemailer');
const config=require('../config');
function startMailDispatcher(store,{transport:providedTransport}={}){
 if(!config.isProd&&!providedTransport)return ()=>{};
 const transport=providedTransport||nodemailer.createTransport({
  host:config.mail.host,port:config.mail.port,secure:config.mail.port===465,requireTLS:true,
  auth:{user:config.mail.user,pass:config.mail.password},
  tls:{minVersion:'TLSv1.2'},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000,
 });
 let active=false,stopped=false,inFlight=Promise.resolve();
 async function dispatch(){
  if(active||stopped)return;active=true;
  try{
   const job=store.nextMail();if(!job)return;
   const url=config.mail.origin+'/register?ticket='+job.ticket;
   await transport.sendMail({from:config.mail.from,to:job.email,subject:'Continue your SecureVault enrollment',
    text:'Open this link to verify your email and continue: '+url+'\nThe link expires 30 minutes after your request. Enter the password you chose when requesting it. If you did not request this, ignore this email.'});
   store.markMailSent(job.id,job.attempt);
  }catch{console.error(JSON.stringify({event:'mail_delivery_failed'}));}
  finally{active=false;}
 }
 const tick=()=>{if(!active&&!stopped)inFlight=dispatch();return inFlight;};
 const interval=setInterval(tick,1000);interval.unref();
 const stop=async()=>{stopped=true;clearInterval(interval);await inFlight;transport.close();};
 stop.dispatch=tick;
 return stop;
}
module.exports={startMailDispatcher};
