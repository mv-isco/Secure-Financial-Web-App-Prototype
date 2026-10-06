'use strict';
const config=require('../config');
const fs=require('node:fs');
const {createStore}=require('../store/database');
function main(){
 if(config.databasePath===':memory:'||!fs.existsSync(config.databasePath))throw new Error('Source database does not exist.');
 const store=createStore();
 try{const result=store.reconcile();console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;}finally{store.close();}
}
if(require.main===module)try{main();}catch(err){console.error(err.message);process.exitCode=1;}
