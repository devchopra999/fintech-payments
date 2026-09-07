const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DATABASE_URL || 'mysql://root:password@localhost:3306/payment_db',
  { logging: false }
);

module.exports = { sequelize };
