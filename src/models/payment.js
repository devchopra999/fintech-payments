const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const Payment = sequelize.define('Payment', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  walletId: { type: DataTypes.UUID, allowNull: false, field: 'wallet_id' },
  userId: { type: DataTypes.UUID, allowNull: false, field: 'user_id' },
  amount: { type: DataTypes.BIGINT, allowNull: false },
  currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: 'USD' },
  gateway: { type: DataTypes.STRING, allowNull: false, defaultValue: 'nexpay' },
  status: { type: DataTypes.ENUM('PENDING', 'SUCCESS', 'FAILED'), allowNull: false, defaultValue: 'PENDING' },
  reference: { type: DataTypes.STRING, allowNull: false, unique: true }
}, {
  tableName: 'payments',
  underscored: true
});

module.exports = { Payment };
