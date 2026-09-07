const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const Transaction = sequelize.define('Transaction', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  paymentId: { type: DataTypes.UUID, allowNull: false, field: 'payment_id' },
  gatewayTransactionId: { type: DataTypes.STRING, allowNull: true, field: 'gateway_transaction_id' },
  status: { type: DataTypes.ENUM('PENDING', 'SUCCESS', 'FAILED'), allowNull: false },
  response: { type: DataTypes.JSON, allowNull: true }
}, {
  tableName: 'transactions',
  underscored: true
});

module.exports = { Transaction };
