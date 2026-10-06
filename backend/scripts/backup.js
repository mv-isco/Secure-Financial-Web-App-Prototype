'use strict';
const {backup,DatabaseSync}=require('node:sqlite');
const config=require('../config');
const path=require('node:path'),fs=require('node:fs');
async function main(){
 const destination=process.argv[2];
 if(!destination||!path.isAbsolute(destination))throw new Error('Provide an absolute backup path outside the project.');
 const project=path.resolve(__dirname,'../..'),relative=path.relative(project,destination);
 if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw new Error('Backups must be outside the project.');
 if(config.databasePath===':memory:'||!fs.existsSync(config.databasePath))throw new Error('Source database does not exist; refusing to create an empty backup.');
 if(fs.existsSync(destination))throw new Error('Backup destination already exists; choose a new path.');
 const db=new DatabaseSync(config.databasePath,{readOnly:true,timeout:5000});
 let reserved=false;
 try{
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||!db.prepare("SELECT name FROM sqlite_master WHERE name='accounts'").get())throw new Error('Source is not a healthy SecureVault database.');
  fs.closeSync(fs.openSync(destination,'wx',0o600));reserved=true;
  await backup(db,destination);console.log('Consistent database backup completed.');reserved=false;
 }finally{db.close();if(reserved)fs.unlinkSync(destination);}
}
if(require.main===module)main().catch(err=>{console.error(err.message);process.exitCode=1;});
