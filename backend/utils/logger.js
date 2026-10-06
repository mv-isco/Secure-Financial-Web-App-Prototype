'use strict';
module.exports = {
 info: message => console.log(JSON.stringify({level:'info',message})),
 warn: message => console.warn(JSON.stringify({level:'warn',message})),
 error: message => console.error(JSON.stringify({level:'error',message})),
};
