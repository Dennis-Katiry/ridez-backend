const bcrypt = require('bcrypt');

const password = 'admin123'; 
const saltRounds = 10;
const hashedPassword = bcrypt.hashSync(password, saltRounds);
console.log(hashedPassword);