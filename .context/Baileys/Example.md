# Baileys Example

This file shows a good example of the use of the Baileys bookstore, an upper part of the code is in description of the file and each object also has its own description so that it is easier to understand the operation.

```typescript
/**
 * @file This is an example file for the Baileys WhatsApp library.
 * It sets up a WhatsApp bot that can connect to WhatsApp,
 * handle events, and send messages.
 *
 * It includes functionality for:
 * - Pairing with a phone using a QR code or a pairing code.
 * - Handling connection updates and automatically reconnecting.
 * - Receiving and processing messages, including auto-replies.
 * - Handling various events like chat updates, contact updates, and more.
 * - Sending different types of messages, including text and media.
 * - Fetching and processing message history.
 *
 * To run this example, you need to have the necessary dependencies installed.
 * You can run it with different options, such as `--do-reply` to enable auto-replies
 * and `--use-pairing-code` to use a pairing code instead of a QR code.
 *
 * @example
 * ```bash
 * # To run with auto-replies
 * npx ts-node Example/example.ts --do-reply
 *
 * # To run with a pairing code
 * npx ts-node Example/example.ts --use-pairing-code
 * ```
 */
// Import necessary modules
import { Boom } from '@hapi/boom' // For handling WhatsApp API errors
import NodeCache from '@cacheable/node-cache' // For caching message retries
import readline from 'readline' // For reading user input in the terminal
import makeWASocket, { // Main function to create a WhatsApp socket
	AnyMessageContent, // Type for any message content
	BinaryInfo, // Binary info for WAM encoding
	delay, // Utility function to wait for a certain amount of time
	DisconnectReason, // Reasons why the socket might disconnect
	downloadAndProcessHistorySyncNotification, // To download and process history sync notifications
	encodeWAM, // To encode WAM (WhatsApp Analytics) data
	fetchLatestBaileysVersion, // To fetch the latest version of Baileys
	getAggregateVotesInPollMessage, // To get aggregate votes in a poll message
	getHistoryMsg, // To get the history message from a protocol message
	isJidNewsletter, // To check if a JID is a newsletter
	makeCacheableSignalKeyStore, // To create a cacheable signal key store
	proto, // WhatsApp protobufs
	useMultiFileAuthState, // To use a multi-file authentication state
	WAMessageContent, // Type for WhatsApp message content
	WAMessageKey // Type for a WhatsApp message key
} from '../src'
//import MAIN_LOGGER from '../src/Utils/logger' // Commented out, but would be for a main logger
import open from 'open' // To open files and URLs
import fs from 'fs' // To interact with the file system
import P from 'pino' // For logging events
const pretty = require('pino-pretty') // To format pino logs
const stream = pretty({
	colorize: true // Colorizes the logger output for better readability
})
var qrcode = require('qrcode-terminal'); // To generate QR codes in the terminal

// Configure logger to save to a file
const logger = P({ timestamp: () => `,"time":"${new Date().toJSON()}"` }, P.destination('./wa-logs.txt'))
logger.level = 'trace' // Very detailed logging level

// Configure logger to display in the console
const mi_logger = P(stream);
mi_logger.level = 'trace' // Very detailed logging level

// --- Configuration variables ---

// Check if the `--do-reply` argument was passed when running the script
const doReplies = process.argv.includes('--do-reply')
// Check if the `--use-pairing-code` argument was passed when running the script
const usePairingCode = process.argv.includes('--use-pairing-code')

// External map to store retry counts of messages when decryption/encryption fails
// Keep this out of the socket itself, so as to prevent a message decryption/encryption loop across socket restarts
const msgRetryCounterCache = new NodeCache()

// Map to store on-demand history requests
const onDemandMap = new Map<string, string>()

// Readline interface to get user input
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
/**
 * Asks a question to the user in the terminal and returns the answer.
 * @param text The question text to display.
 * @returns A promise that resolves with the user's answer.
 */
const question = (text: string) => new Promise<string>((resolve) => rl.question(text, resolve))

// --- Main function to start the connection ---

/**
 * Starts a WhatsApp socket connection.
 * Sets up the authentication state, WhatsApp Web version,
 * and event handlers for the socket.
 */
const startSock = async () => {
	// Load authentication state from files.
	// `state` contains the credentials and keys.
	// `saveCreds` is a function to save the updated state.
	const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
	// Fetch the latest version of WhatsApp Web
	const { version, isLatest } = await fetchLatestBaileysVersion()
	mi_logger.debug(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

	// Create a new WhatsApp socket instance with the required configuration
	const sock = makeWASocket({
		version, // The version of WhatsApp Web to use
		logger, // The logger to save to a file
		// printQRInTerminal: !usePairingCode, // Print the QR code in the terminal if not using a pairing code
		auth: {
			creds: state.creds, // The authentication credentials
			/** caching makes the store faster to send/recv messages */
			keys: makeCacheableSignalKeyStore(state.keys, logger), // Cacheable signal key store
		},
		msgRetryCounterCache, // Cache for message retries
		generateHighQualityLinkPreview: true, // Generate high-quality link previews
		// ignore all broadcast messages -- to receive the same
		// comment the line below out
		// shouldIgnoreJid: jid => isJidBroadcast(jid),
		// implement to handle retries & poll updates
		getMessage,
	})

	// Pairing code for Web clients
	if (usePairingCode && !sock.authState.creds.registered) {
		// Ask the user for their phone number
		const phoneNumber = await question('Please enter your phone number:\n')
		// Request a pairing code from WhatsApp
		const code = await sock.requestPairingCode(phoneNumber)
		mi_logger.debug(`Pairing code: ${code}`)
	}

	/**
	 * Sends a message with a typing indicator.
	 * @param msg The message content to send.
	 * @param jid The JID (Jabber ID) of the recipient.
	 */
	const sendMessageWTyping = async (msg: AnyMessageContent, jid: string) => {
		// Subscribe to the recipient's presence
		await sock.presenceSubscribe(jid)
		// Wait for 500ms
		await delay(500)

		// Send a "composing" presence update
		await sock.sendPresenceUpdate('composing', jid)
		// Wait for 2 seconds
		await delay(2000)

		// Send a "paused" presence update
		await sock.sendPresenceUpdate('paused', jid)

		// Send the actual message
		await sock.sendMessage(jid, msg)
	}

	// The `process` function lets you process all events that just occurred
	// efficiently in a batch
	sock.ev.process(
		// `events` is a map of event name to event data
		async (events) => {
			// --- Connection update event handler ---
			if (events['connection.update']) {
				const update = events['connection.update']
				const { connection, lastDisconnect } = update
				if (connection === 'close') {
					// Reconnect if not logged out
					if ((lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
						startSock()
					} else {
						mi_logger.debug('Connection closed. You are logged out.')
					}
				}

				// WARNING: THIS WILL SEND A WAM EXAMPLE AND THIS IS A ****CAPTURED MESSAGE.****
				// DO NOT ACTUALLY ENABLE THIS UNLESS YOU MODIFIED THE FILE.JSON!!!!!
				// THE ANALYTICS IN THE FILE ARE OLD. DO NOT USE THEM.
				// YOUR APP SHOULD HAVE GLOBALS AND ANALYTICS ACCURATE TO TIME, DATE AND THE SESSION
				// THIS FILE.JSON APPROACH IS JUST AN APPROACH I USED, BE FREE TO DO THIS IN ANOTHER WAY.
				// THE FIRST EVENT CONTAINS THE CONSTANT GLOBALS, EXCEPT THE seqenceNumber(in the event) and commitTime
				// THIS INCLUDES STUFF LIKE ocVersion WHICH IS CRUCIAL FOR THE PREVENTION OF THE WARNING
				const sendWAMExample = false;
				if (connection === 'open' && sendWAMExample) {
					/// sending WAM EXAMPLE
					const {
						header: {
							wamVersion,
							eventSequenceNumber,
						},
						events,
					} = JSON.parse(await fs.promises.readFile("./boot_analytics_test.json", "utf-8"))

					const binaryInfo = new BinaryInfo({
						protocolVersion: wamVersion,
						sequence: eventSequenceNumber,
						events: events
					})

					const buffer = encodeWAM(binaryInfo);

					const result = await sock.sendWAMBuffer(buffer)
					mi_logger.debug(result)
				}
				// If there is a QR code, generate it in the terminal
				update.qr ? qrcode.generate(update.qr, { small: true }) : ''
				mi_logger.debug('connection update', update)
			}

			// --- Credentials update event handler ---
			/**
			 * Credentials updated -- save them.
			 * This event is fired when the authentication credentials change,
			 * for example, after a successful login or re-authentication.
			 */
			if (events['creds.update']) {
				await saveCreds()
			}

			// --- Other event handlers ---

			/** Labels association event. */
			if (events['labels.association']) {
				mi_logger.debug(events['labels.association'])
			}

			/** Labels edit event. */
			if (events['labels.edit']) {
				mi_logger.debug(events['labels.edit'])
			}

			/** Incoming call event. */
			if (events.call) {
				mi_logger.debug('recv call event', events.call)
			}

			/**
			 * History received event.
			 * This event is fired when new chat history data is received.
			 */
			if (events['messaging-history.set']) {
				const { chats, contacts, messages, isLatest, progress, syncType } = events['messaging-history.set']
				if (syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
					mi_logger.debug('received on-demand history sync, messages=', messages)
				}
				mi_logger.debug(`recv ${chats.length} chats, ${contacts.length} contacts, ${messages.length} msgs (is latest: ${isLatest}, progress: ${progress}%), type: ${syncType}`)
			}

			/**
			 * Received a new message event.
			 * This event is fired when new messages are received or existing messages are updated.
			 */
			if (events['messages.upsert']) {
				const upsert = events['messages.upsert']
				mi_logger.debug('recv messages ', JSON.stringify(upsert, undefined, 2))

				if (upsert.type === 'notify') {
					for (const msg of upsert.messages) {
						//TODO: More built-in implementation of this
						/* if (
							msg.message?.protocolMessage?.type ===
							proto.Message.ProtocolMessage.Type.HISTORY_SYNC_NOTIFICATION
							) {
							const historySyncNotification = getHistoryMsg(msg.message)
							if (
								historySyncNotification?.syncType ==
								proto.HistorySync.HistorySyncType.ON_DEMAND
							) {
								const { messages } =
								await downloadAndProcessHistorySyncNotification(
									historySyncNotification,
									{}
								)


								const chatId = onDemandMap.get(
									historySyncNotification!.peerDataRequestSessionId!
								)

								mi_logger.debug(messages)

								onDemandMap.delete(
									historySyncNotification!.peerDataRequestSessionId!
								)

								/*
								// 50 messages is the limit imposed by whatsapp
								//TODO: Add ratelimit of 7200 seconds
								//TODO: Max retries 10
								const messageId = await sock.fetchMessageHistory(
									50,
									oldestMessageKey,
									oldestMessageTimestamp
								)
								onDemandMap.set(messageId, chatId)
							}
							} */

						if (msg.message?.conversation || msg.message?.extendedTextMessage?.text) {
							/**
							 * Extracts the text content from a message.
							 * It prioritizes `conversation` field, then `extendedTextMessage.text`.
							 */
							const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text
							/**
							 * Handles a specific command "requestPlaceholder".
							 * If the message text is "requestPlaceholder" and there's no `requestId` in the upsert event,
							 * it requests a resend of the placeholder message.
							 */
							if (text == "requestPlaceholder" && !upsert.requestId) {
								const messageId = await sock.requestPlaceholderResend(msg.key)
								mi_logger.debug('requested placeholder resync, id=', messageId)
								/**
								 * Logs messages received from the phone, identified by `requestId`.
								 */
							} else if (upsert.requestId) {
								mi_logger.debug('Message received from phone, id=', upsert.requestId, msg)
							}

							/**
							 * Handles a specific command "onDemandHistSync".
							 * If the message text is "onDemandHistSync", it requests an on-demand history synchronization.
							 */
							if (text == "onDemandHistSync") {
								const messageId = await sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp!)
								mi_logger.debug('requested on-demand sync, id=', messageId)
							}
						}

						/**
						 * If the message is not from me, and doReplies is enabled, and the message is not from a newsletter,
						 * then reply to the message.
						 * It marks the message as read, sends a typing indicator, and then sends a "Hello there!" message.
						 * This is a basic auto-reply mechanism.
						 */
						if (!msg.key.fromMe && doReplies && !isJidNewsletter(msg.key?.remoteJid!)) {

							mi_logger.debug('replying to', msg.key.remoteJid)
							await sock!.readMessages([msg.key])
							await sendMessageWTyping({ text: 'Hello there!' }, msg.key.remoteJid!)
						}
					}
				}
			}

			/**
			 * Messages updated event.
			 * This event is fired when message statuses are updated (e.g., delivered, read) or messages are deleted.
			 */
			if (events['messages.update']) {
				mi_logger.debug(
					JSON.stringify(events['messages.update'], undefined, 2)
				)

				for (const { key, update } of events['messages.update']) {
					if (update.pollUpdates) {
						const pollCreation: proto.IMessage = {} // get the poll creation message somehow
						if (pollCreation) {
							mi_logger.debug(
								'got poll update, aggregation: ',
								getAggregateVotesInPollMessage({
									message: pollCreation,
									pollUpdates: update.pollUpdates,
								})
							)
						}
					}
				}
			}

			/** Message receipt update event. */
			if (events['message-receipt.update']) {
				mi_logger.debug(events['message-receipt.update'])
			}

			/** Messages reaction event. */
			if (events['messages.reaction']) {
				mi_logger.debug(events['messages.reaction'])
			}

			/** Presence update event. */
			if (events['presence.update']) {
				mi_logger.debug(events['presence.update'])
			}



			/** Chats update event. */
			if (events['chats.update']) {
				mi_logger.debug(events['chats.update'])
			}

			/**
			 * Contacts update event.
			 * This event is fired when contact information changes, such as profile pictures.
			 */
			if (events['contacts.update']) {
				for (const contact of events['contacts.update']) {
					if (typeof contact.imgUrl !== 'undefined') {
						const newUrl = contact.imgUrl === null
							? null
							: await sock!.profilePictureUrl(contact.id!).catch(() => null)
						mi_logger.debug(
							`contact ${contact.id} has a new profile pic: ${newUrl}`,
						)
					}
				}
			}

			/** Chats delete event. */
			if (events['chats.delete']) {
				mi_logger.debug('chats deleted ', events['chats.delete'])
			}
		}
	)

	return sock

	/**
	 * Gets a message from the store.
	 * @param key The key of the message to get.
	 * @returns The message content or undefined if not found.
	 */
	async function getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
		// Implement a way to retreive messages that were upserted from messages.upsert
		// up to you

		// only if store is present
		return proto.Message.fromObject({})
	}
}

// Start the socket connection

startSock()
```