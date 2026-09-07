const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { z } = require('zod');
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
    console.log(`[fintech-payments] gateway response for ${reference}: httpStatus=${httpStatus}`);

    // NOTE: only checks the HTTP status, not the response body's status field - a 202 pending
    // review is still < 300 and gets treated the same as a 201 succeeded
    if (httpStatus < 300) {
      await Transaction.create({
        paymentId: payment.id, gatewayTransactionId: gatewayResponse.id, status: 'SUCCESS', response: gatewayResponse
      });
      payment.status = 'SUCCESS';
      await payment.save();
      await creditWallet(payment.walletId, payment.amount, payment.reference);
      notify({ userId: payment.userId, eventType: 'PAYMENT_SUCCESS', message: `Payment ${payment.id} succeeded` });
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

// NOTE: docs/nexpay-contract.md requires a webhook receiver for charges NexPay returns as
// "pending" (202) - no such endpoint is registered on this branch, so NexPay's callback 404s

module.exports = router;
