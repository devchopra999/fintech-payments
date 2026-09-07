const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { z } = require('zod');
const { sequelize } = require('../db');
const { Payment } = require('../models/payment');
const { Transaction } = require('../models/transaction');
const { requireAuth } = require('../middleware/auth');
const gatewayClient = require('../gatewayClient');
const { creditWallet } = require('../ledgerClient');
const { notify } = require('../notify');

const router = express.Router();

const initiateSchema = z.object({
  walletId: z.string().uuid(),
  amount: z.number().int().positive(),
  currency: z.string().length(3).default('USD'),
  source: z.string().min(1)
});

router.post('/payment/initiate', requireAuth, async (req, res, next) => {
  try {
    const body = initiateSchema.parse(req.body);
    const reference = uuidv4();
    console.log(`[fintech-payments] payment initiate: wallet ${body.walletId} amount ${body.amount} ${body.currency} (ref ${reference})`);

    const payment = await Payment.create({
      walletId: body.walletId,
      userId: req.user.sub,
      amount: body.amount,
      currency: body.currency,
      gateway: 'nexpay',
      status: 'PENDING',
      reference
    });

    const { httpStatus, body: gatewayResponse } = await gatewayClient.charge({
      amount: body.amount,
      currency: body.currency,
      reference,
      source: body.source
    });
    console.log(`[fintech-payments] gateway response for ${reference}: httpStatus=${httpStatus} status=${gatewayResponse.status}`);

    // NexPay's contract requires branching on the response body's status, not just the HTTP
    // status - 202 is still a 2xx but means "pending review", not "succeeded"
    if (gatewayResponse.status === 'succeeded') {
      await Transaction.create({
        paymentId: payment.id, gatewayTransactionId: gatewayResponse.id, status: 'SUCCESS', response: gatewayResponse
      });
      payment.status = 'SUCCESS';
      await payment.save();
      await creditWallet(payment.walletId, payment.amount, payment.reference);
      notify({ userId: payment.userId, eventType: 'PAYMENT_SUCCESS', message: `Payment ${payment.id} succeeded` });
    } else if (gatewayResponse.status === 'pending') {
      await Transaction.create({
        paymentId: payment.id, gatewayTransactionId: gatewayResponse.id, status: 'PENDING', response: gatewayResponse
      });
      // stays PENDING until NexPay's webhook resolves it - do not credit the wallet yet
    } else {
      await Transaction.create({
        paymentId: payment.id,
        gatewayTransactionId: gatewayResponse.id || null,
        status: 'FAILED',
        response: gatewayResponse
      });
      payment.status = 'FAILED';
      await payment.save();
      notify({ userId: payment.userId, eventType: 'PAYMENT_FAILED', message: `Payment ${payment.id} failed` });
    }

    res.status(httpStatus === 400 ? 400 : 201).json({ payment });
  } catch (err) {
    next(err);
  }
});

router.get('/payment/:id', requireAuth, async (req, res, next) => {
  try {
    const payment = await Payment.findByPk(req.params.id);
    if (!payment) return res.status(404).json({ error: { code: 'PAYMENT_NOT_FOUND', message: 'payment not found' } });
    const transactions = await Transaction.findAll({ where: { paymentId: payment.id }, order: [['createdAt', 'ASC']] });
    res.json({ payment, transactions });
  } catch (err) {
    next(err);
  }
});

router.get('/payment/wallet/:walletId', requireAuth, async (req, res, next) => {
  try {
    const payments = await Payment.findAll({ where: { walletId: req.params.walletId }, order: [['createdAt', 'DESC']] });
    res.json({ payments });
  } catch (err) {
    next(err);
  }
});

// called by NexPay, not the end user - no bearer auth, matches the shared contract in docs/nexpay-contract.md
router.post('/payment/webhook/nexpay', async (req, res, next) => {
  try {
    const { reference, status, id: gatewayTransactionId } = req.body;
    console.log(`[fintech-payments] webhook received for reference ${reference}: status=${status}`);

    // lock the payment row and re-check its status inside the transaction so two concurrent
    // deliveries of the same webhook can't both pass the "already resolved" check and both write
    const result = await sequelize.transaction(async (t) => {
      const payment = await Payment.findOne({ where: { reference }, transaction: t, lock: t.LOCK.UPDATE });
      if (!payment) throw Object.assign(new Error('unknown reference'), { statusCode: 404, code: 'PAYMENT_NOT_FOUND' });

      // NexPay may deliver the webhook more than once for the same charge - resolving an
      // already-resolved payment again must be a no-op, never a second credit
      if (payment.status !== 'PENDING') {
        return { payment, alreadyResolved: true };
      }

      if (status === 'succeeded') {
        await Transaction.create({ paymentId: payment.id, gatewayTransactionId, status: 'SUCCESS', response: req.body }, { transaction: t });
        payment.status = 'SUCCESS';
        await payment.save({ transaction: t });
      } else {
        await Transaction.create({ paymentId: payment.id, gatewayTransactionId, status: 'FAILED', response: req.body }, { transaction: t });
        payment.status = 'FAILED';
        await payment.save({ transaction: t });
      }

      return { payment, alreadyResolved: false };
    });

    if (result.alreadyResolved) {
      return res.status(200).json({ message: 'already resolved', payment: result.payment });
    }

    if (result.payment.status === 'SUCCESS') {
      await creditWallet(result.payment.walletId, result.payment.amount, result.payment.reference);
      notify({ userId: result.payment.userId, eventType: 'PAYMENT_SUCCESS', message: `Payment ${result.payment.id} succeeded` });
    } else {
      notify({ userId: result.payment.userId, eventType: 'PAYMENT_FAILED', message: `Payment ${result.payment.id} failed` });
    }

    res.status(200).json({ payment: result.payment });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    next(err);
  }
});

module.exports = router;
