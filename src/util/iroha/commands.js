/*
 * Copyright D3 Ledger, Inc. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  commands,
  signWithArrayOfKeys,
  sendTransactions,
  txHelper
} from 'iroha-helpers'
import Transaction from 'iroha-helpers/lib/proto/transaction_pb'
import {
  newCommandService,
  newCommandServiceOptions
} from './util'
import cloneDeep from 'lodash/fp/cloneDeep'
import { FeeTypes } from '@/data/consts'

const DEFAULT_TIMEOUT_LIMIT = 5000

// /**
//  * signPendingTransaction: sign transaction with more keys and send.
//  * @param {Array.<String>} privateKeys
//  * @param {Object} transaction
//  */
function signPendingTransaction (privateKeys = [], transaction, timeoutLimit = DEFAULT_TIMEOUT_LIMIT) {
  /*
    * TODO: Remove clearSignaturesList() after
    * https://soramitsu.atlassian.net/browse/IR-1680 is completed
    * Now we should remove signatures because otherwise the transaction
    * won't get to MST processor and will be immediately commited
  */
  let txToSend = cloneDeep(transaction)
  txToSend.clearSignaturesList()

  txToSend = signWithArrayOfKeys(txToSend, privateKeys)

  let txClient = newCommandService()

  return sendTransactions([txToSend], txClient, timeoutLimit, [
    'COMMITTED'
  ])
}

/**
 * Create settlement: an exchange request
 * @param {Array.<String>} senderPrivateKeys
 * @param {String} senderAccountId
 * @param {Number} senderQuorum
 * @param {String} senderAssetId
 * @param {String} senderAmount
 * @param {String} description
 * @param {String} receiverAccountId
 * @param {Number} receiverQuorum
 * @param {String} receiverAssetId
 * @param {String} receiverAmount
 * @param {Number} timeoutLimit
 * @param {String} feeType
 * @param {Number} senderFee
 * @param {Number} recieverFee
 */
function createSettlement (senderPrivateKeys, senderAccountId, senderQuorum = 1, senderAssetId, senderAmount, description, receiverAccountId, receiverQuorum = 1, receiverAssetId, receiverAmount, feeType, senderFee = 0, receiverFee = 0, timeoutLimit = DEFAULT_TIMEOUT_LIMIT) {
  let txClient = newCommandService()
  const feeAccountId = `${feeType}@d3`

  let senderTx = txHelper.addCommand(
    txHelper.emptyTransaction(),
    'transferAsset',
    { srcAccountId: senderAccountId, destAccountId: receiverAccountId, assetId: senderAssetId, description, amount: senderAmount }
  )
  if (senderFee > 0) {
    senderTx = txHelper.addCommand(
      senderTx,
      'transferAsset',
      { srcAccountId: senderAccountId, destAccountId: feeAccountId, assetId: senderAssetId, description, amount: senderFee }
    )
  }
  senderTx = txHelper.addMeta(senderTx, { creatorAccountId: senderAccountId, quorum: senderQuorum })

  let receiverTx = txHelper.addCommand(
    txHelper.emptyTransaction(),
    'transferAsset',
    { srcAccountId: receiverAccountId, destAccountId: senderAccountId, assetId: receiverAssetId, description, amount: receiverAmount }
  )
  if (receiverFee > 0) {
    receiverTx = txHelper.addCommand(
      receiverTx,
      'transferAsset',
      { srcAccountId: receiverAccountId, destAccountId: feeAccountId, assetId: receiverAssetId, description, amount: receiverFee }
    )
  }
  receiverTx = txHelper.addMeta(receiverTx, { creatorAccountId: receiverAccountId, quorum: receiverQuorum })

  const batchArray = txHelper.addBatchMeta([senderTx, receiverTx], 0)
  batchArray[0] = signWithArrayOfKeys(batchArray[0], senderPrivateKeys)

  return sendTransactions(batchArray, txClient, timeoutLimit, [
    'MST_PENDING'
  ])
}

function acceptSettlement (privateKeys, batchArray, accountId, timeoutLimit = DEFAULT_TIMEOUT_LIMIT) {
  if (!batchArray.length) return

  const txClient = newCommandService()

  const indexOfUnsigned = cloneDeep(batchArray)
    .map(tx => tx.toObject())
    .findIndex(tx => {
      return tx.payload.reducedPayload.creatorAccountId === accountId
    })

  if (indexOfUnsigned === -1) throw new Error('Undefined tx to sign')

  batchArray.forEach(tx => tx.clearSignaturesList())

  batchArray[indexOfUnsigned] = signWithArrayOfKeys(batchArray[indexOfUnsigned], privateKeys)

  return sendTransactions(batchArray, txClient, timeoutLimit, [
    'COMMITTED'
  ])
}

function rejectSettlement (privateKeys, batchArray, timeoutLimit = DEFAULT_TIMEOUT_LIMIT) {
  if (!batchArray.length) return

  const txClient = newCommandService()

  batchArray.forEach(tx => tx.clearSignaturesList())

  const batch = batchArray.map(b => signWithArrayOfKeys(b, privateKeys))

  return sendTransactions(batch, txClient, timeoutLimit, [
    'REJECTED',
    'STATEFUL_VALIDATION_FAILED'
  ])
}

function sendCustomTransaction (bytes, timeoutLimit = DEFAULT_TIMEOUT_LIMIT) {
  const txClient = newCommandService()
  let tx = Transaction.Transaction.deserializeBinary(bytes)

  return sendTransactions([tx], txClient, timeoutLimit, [
    'COMMITTED'
  ])
}

const createAccount = (privateKeys, quorum, {
  accountName,
  domainId,
  publicKey
}) => commands.createAccount(
  newCommandServiceOptions(privateKeys, quorum), {
    accountName,
    domainId,
    publicKey
  }
)

const createAsset = (privateKeys, quorum, {
  assetName,
  domainId,
  precision
}) => commands.createAsset(
  newCommandServiceOptions(privateKeys, quorum), {
    assetName,
    domainId,
    precision
  }
)

const transferAsset = (privateKeys, quorum, {
  srcAccountId,
  destAccountId,
  assetId,
  description,
  amount
}) => commands.transferAsset(
  newCommandServiceOptions(privateKeys, quorum), {
    srcAccountId,
    destAccountId,
    assetId,
    description,
    amount
  }
)

const transferAssetWithFee = (privateKeys, quorum, {
  srcAccountId,
  destAccountId,
  assetId,
  description,
  amount,
  fee,
  feeType,
  timeoutLimit = DEFAULT_TIMEOUT_LIMIT
}) => {
  const txClient = newCommandService()

  let senderTx = txHelper.addCommand(
    txHelper.emptyTransaction(),
    'transferAsset',
    { srcAccountId, destAccountId, assetId, description, amount }
  )

  if (fee > 0) {
    if (feeType === FeeTypes.WITHDRAWAL) {
      senderTx = txHelper.addCommand(
        senderTx,
        'transferAsset',
        { srcAccountId, destAccountId, assetId, description: 'withdrawal fee', amount: fee }
      )
    } else {
      const feeAccountId = `${feeType}@d3`
      senderTx = txHelper.addCommand(
        senderTx,
        'transferAsset',
        { srcAccountId, destAccountId: feeAccountId, assetId, description, amount: fee }
      )
    }
  }

  senderTx = txHelper.addMeta(senderTx, { creatorAccountId: srcAccountId, quorum })
  senderTx = signWithArrayOfKeys(senderTx, privateKeys)

  return sendTransactions([senderTx], txClient, timeoutLimit, [
    'COMMITTED',
    'COMMITTED'
  ])
}

const addSignatory = (privateKeys, quorum, {
  accountId,
  publicKey
}) => commands.addSignatory(
  newCommandServiceOptions(privateKeys, quorum), {
    accountId,
    publicKey
  }
)

const removeSignatory = (privateKeys, quorum, {
  accountId,
  publicKey
}) => commands.removeSignatory(
  newCommandServiceOptions(privateKeys, quorum), {
    accountId,
    publicKey
  }
)

const addAssetQuantity = (privateKeys, quorum, {
  assetId,
  amount
}) => commands.addAssetQuantity(
  newCommandServiceOptions(privateKeys, quorum), {
    assetId,
    amount
  }
)

const setAccountDetail = (privateKeys, quorum, {
  accountId,
  key,
  value
}) => commands.setAccountDetail(
  newCommandServiceOptions(privateKeys, quorum), {
    accountId,
    key,
    value
  }
)

const setAccountQuorum = (privateKeys, currentQuorum, {
  accountId,
  quorum
}) => commands.setAccountQuorum(
  newCommandServiceOptions(privateKeys, currentQuorum), {
    accountId,
    quorum
  }
)

export {
  createAccount,
  createAsset,
  transferAsset,
  transferAssetWithFee,
  addSignatory,
  removeSignatory,
  addAssetQuantity,
  createSettlement,
  acceptSettlement,
  rejectSettlement,
  setAccountDetail,
  setAccountQuorum,
  sendCustomTransaction,
  signPendingTransaction
}
