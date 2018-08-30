/* eslint-disable no-unused-vars */
/*
 * NODE_IP=http://localhost:8080 DEBUG=iroha-util node scripts/setup.js
 */

import fs from 'fs'
import path from 'path'
import _ from 'lodash'
import irohaUtil from '../src/util/iroha-util'
import { derivePublicKey } from 'ed25519.js'

const irohaDomain = 'notary'
const testAccName = 'test'
const aliceAccName = 'alice'
const testAccFull = `${testAccName}@${irohaDomain}`
const aliceAccFull = `${aliceAccName}@${irohaDomain}`

const testPrivKeyHex = fs.readFileSync(path.join(__dirname, `${testAccFull}.priv`)).toString().trim()
const testPubKey = derivePublicKey(Buffer.from(testPrivKeyHex, 'hex'))
const alicePrivKeyHex = fs.readFileSync(path.join(__dirname, `${aliceAccFull}.priv`)).toString().trim()
const alicePubKey = derivePublicKey(Buffer.from(alicePrivKeyHex, 'hex'))

// IP should start with 'http'
const nodeIp = process.env.NODE_IP || 'http://127.0.0.1:8080'
const DUMMY_FILE_PATH = path.join(__dirname, '../src/mocks/wallets.json')
const accounts = [testAccFull, aliceAccFull]
const wallets = require(DUMMY_FILE_PATH).wallets

console.log(`setting up accounts and assets with using '${DUMMY_FILE_PATH}'`)
console.log(`accounts: ${accounts.join(', ')}`)
console.log(`assets: ${wallets.map(w => w.name).join(', ')}`)
console.log('')

irohaUtil.login(`${testAccFull}`, testPrivKeyHex, nodeIp)
  .then(() => tryToCreateAccount(aliceAccName, irohaDomain, alicePubKey))
  .then(() => irohaUtil.setAccountDetail(testPrivKeyHex, testAccFull, 'ethereum_wallet', '0xAdmin-ethereum_wallet'))
  .then(() => irohaUtil.setAccountDetail(testPrivKeyHex, aliceAccFull, 'ethereum_wallet', '0xAlice-ethereum_wallet'))

  .then(() => initializeAssets())
  .then(() => irohaUtil.logout())
  .then(() => setupAccountTransactions(`${testAccFull}`, testPrivKeyHex))
  .then(() => setupAccountTransactions(`${aliceAccFull}`, alicePrivKeyHex))
  .then(() => console.log('done!'))
  .catch(err => console.error(err))

function initializeAssets () {
  console.log('initializing assets')

  const initializingAssets = wallets.map(w => {
    const precision = String(w.amount).split('.')[1].length
    const amount = String(w.amount)
    const assetName = w.name.toLowerCase()
    const assetId = assetName + `#${irohaDomain}`

    return tryToCreateAsset(assetName, `${irohaDomain}`, precision)
      .then(() => {
        console.log(`adding initial amount of ${assetId} to ${testAccFull}`)

        return irohaUtil.addAssetQuantity(testPrivKeyHex, `${w.name.toLowerCase()}#${irohaDomain}`, amount)
      })
      .then(() => {
        console.log(`distributing initial amount of ${assetId} to every account`)

        const transferringInitialAssets = _.without(accounts, `${testAccFull}`).map(accountId => {
          const amount = String(Math.random() + 1).substr(0, precision + 2)

          return irohaUtil.transferAsset(testPrivKeyHex, `${testAccFull}`, accountId, `${w.name.toLowerCase()}#${irohaDomain}`, 'initial tx', amount).catch(() => {})
        })

        return Promise.all(transferringInitialAssets)
      })
  })

  return Promise.all(initializingAssets)
}

function setupAccountTransactions (accountId, accountPrivKeyHex) {
  console.log(`issuing random tx from ${accountId} to another`)

  return irohaUtil.login(accountId, accountPrivKeyHex, nodeIp)
    .then(() => {
      const txs = []

      wallets.map(w => {
        const precision = String(w.amount).split('.')[1].length

        _.times(_.random(3, 5), () => {
          const from = accountId
          const to = _.sample(_.without(accounts, from))
          const message = _.sample(['hello', 'hi', '', 'PART_OF_DUMMY_SETTLEMENT'])
          const amount = String(Math.random()).substr(0, precision + 2)

          const p = irohaUtil.transferAsset(testPrivKeyHex, from, to, `${w.name.toLowerCase()}#${irohaDomain}`, message, amount).catch(() => {})

          txs.push(p)
        })
      })

      return Promise.all(txs)
    })
    .then(() => irohaUtil.logout())
}

function tryToCreateAccount (accountName, domainId, publicKey) {
  console.log(`trying to create an account: ${accountName}@${domainId}`)

  return new Promise((resolve, reject) => {
    irohaUtil.createAccount(testPrivKeyHex, accountName, domainId, publicKey)
      .then(() => {
        console.log(`${accountName}@${domainId} has successfully been created`)
        resolve()
      })
      .catch(err => {
        irohaUtil.getAccount(accountName + '@' + domainId)
          .then(account => {
            console.log(`${account.accountId} already exist`)
            resolve()
          })
          .catch(() => reject(err))
      })
  })
}

function tryToCreateAsset (assetName, domainId, precision) {
  console.log(`trying to create an asset: ${assetName}#${domainId} (precision=${precision})`)

  return new Promise((resolve, reject) => {
    irohaUtil.createAsset(testPrivKeyHex, assetName, domainId, precision)
      .then(() => {
        console.log(`${assetName}#${domainId} (precision: ${precision}) has successfully been created`)
        resolve()
      })
      .catch(err => {
        irohaUtil.getAssetInfo(assetName + '#' + domainId)
          .then(info => {
            if (info.asset.precision === precision) {
              console.log(`${assetName}#${domainId} (precision=${precision}) already exist`)
              resolve()
            } else {
              reject(new Error(`${assetName}#${domainId} is already used with different precision.`))
            }
          })
          .catch(() => reject(err))
      })
  })
}