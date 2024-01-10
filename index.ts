import 'dotenv/config';
import * as bs58 from "bs58";
import { AnchorProvider, BN, Wallet } from '@coral-xyz/anchor';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
    BASE_PRECISION,
    BulkAccountLoader,
    calculateBidAskPrice,
    calculateTradeSlippage,
    convertToNumber,
    DriftClient,
    DriftEnv,
    getMarketOrderParams,
    getMarketsAndOraclesForSubscription, getUserAccountPublicKey,
    initialize,
    PerpMarkets,
    PositionDirection,
    PRICE_PRECISION,
    QUOTE_PRECISION, SpotMarkets, TokenFaucet,
    User
} from '@drift-labs/sdk';

export const getTokenAddress = (
    mintAddress: string,
    userPubKey: string
): Promise<PublicKey> => {
    return getAssociatedTokenAddress(
        new PublicKey(mintAddress),
        new PublicKey(userPubKey),
        true,
        TOKEN_PROGRAM_ID,
        new PublicKey(`ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`),
    );
};

const main = async () => {
    const env = 'devnet' as DriftEnv;
    // Initialize Drift SDK
    const sdkConfig = initialize({ env });

    // Set up the Wallet and Provider
    const privateKey = process.env.BOT_PRIVATE_KEY; // stored as an array string
    if (!privateKey) {
        throw new Error('Bot private key not found');
    }
    const keypair = Keypair.fromSecretKey(
        bs58.decode(privateKey)
    );
    const wallet = new Wallet(keypair);

    // Set up the Connection
    const rpcAddress = process.env.RPC_ADDRESS; // can use: https://api.devnet.solana.com for devnet; https://api.mainnet-beta.solana.com for mainnet;
    if (!rpcAddress) {
        throw new Error('RPC address not found');
    }
    const connection = new Connection(rpcAddress);

    if (env === 'devnet') {
        try {
            //const signature = await connection.requestAirdrop(wallet.publicKey, LAMPORTS_PER_SOL);
            //await connection.confirmTransaction(signature);
        } catch (e) {
            // ignore
        }
    }

    // Set up the Provider
    const provider = new AnchorProvider(
        connection,
        wallet,
        AnchorProvider.defaultOptions()
    );

    // Check SOL Balance
    const lamportsBalance = await connection.getBalance(wallet.publicKey);
    console.log('SOL balance:', lamportsBalance / 10 ** 9);

    // Misc. other things to set up

    // Set up the Drift Client
    const driftPublicKey = new PublicKey(sdkConfig.DRIFT_PROGRAM_ID);
    const bulkAccountLoader = new BulkAccountLoader(
        connection,
        'confirmed',
        1000
    );
    const driftClient = new DriftClient({
        connection,
        wallet,
        programID: driftPublicKey,
        ...getMarketsAndOraclesForSubscription(env),
        accountSubscription: {
            type: 'polling',
            accountLoader: bulkAccountLoader,
        },
    });
    await driftClient.subscribe();

    // Set up user client
    let userAccountPublicKey;
    try {
        userAccountPublicKey = await driftClient.getUserAccountPublicKey();
    } catch (e) {
        userAccountPublicKey = await getUserAccountPublicKey(driftPublicKey, wallet.publicKey);
    }
    const user = new User({
        driftClient: driftClient,
        userAccountPublicKey,
        accountSubscription: {
            type: 'polling',
            accountLoader: bulkAccountLoader,
        },
    });

    //// Check if user account exists for the current wallet
    const userAccountExists = await user.exists();

    if (!userAccountExists) {
        //// Create a Clearing House account by Depositing some USDC ($10,000 in this case)
        const depositAmount = new BN(10000).mul(QUOTE_PRECISION);
        if (env === 'mainnet-beta') {
            await driftClient.initializeUserAccountAndDepositCollateral(
                depositAmount,
                await getTokenAddress(
                    sdkConfig.USDC_MINT_ADDRESS,
                    wallet.publicKey.toString()
                )
            );
        } else if (env === 'devnet') {
            const tokenFaucet = new TokenFaucet(
                connection,
                wallet,
                new PublicKey(
                    'V4v1mQiAdLz4qwckEb45WqHYceYizoib39cDBHSWfaB'
                ),
                SpotMarkets[env][0].mint
            );
            await driftClient.initializeUserAccountForDevnet(0, 'TEST-1', 0, tokenFaucet, depositAmount);
        }
    }

    await user.subscribe();

    await driftClient.updateUserMarginTradingEnabled([{ marginTradingEnabled: true, subAccountId: user.getUserAccount().subAccountId }]);

    // Get current price
    const solPerpMarketInfo = PerpMarkets[env].find(
        (market) => market.baseAssetSymbol === 'SOL'
    );
    if (solPerpMarketInfo?.marketIndex === undefined) {
        throw new Error('Could not find SOL Perp market');
    }
    const solPerpMarketAccount = driftClient.getPerpMarketAccount(solPerpMarketInfo.marketIndex);
    if (!solPerpMarketAccount) {
        throw new Error('Could not find Perp Market Account');
    }

    const [bid, ask] = calculateBidAskPrice(
        solPerpMarketAccount.amm,
        driftClient.getOracleDataForPerpMarket(solPerpMarketInfo.marketIndex)
    );

    const formattedBidPrice = convertToNumber(bid, PRICE_PRECISION);
    const formattedAskPrice = convertToNumber(ask, PRICE_PRECISION);

    console.log(
        `Current amm bid and ask price are $${formattedBidPrice} and $${formattedAskPrice}`
    );

    const slippage = convertToNumber(
        calculateTradeSlippage(
            PositionDirection.LONG,
            new BN(1).mul(BASE_PRECISION),
            solPerpMarketAccount,
            'base',
            driftClient.getOracleDataForPerpMarket(solPerpMarketInfo.marketIndex)
        )[0],
        PRICE_PRECISION
    );

    console.log(`Slippage for a 1 SOL-PERP would be $${slippage}`);

    await driftClient.placePerpOrder(
        getMarketOrderParams({
            baseAssetAmount: new BN(1).mul(BASE_PRECISION),
            direction: PositionDirection.LONG,
            marketIndex: solPerpMarketAccount.marketIndex,
        })
    );
    console.log(`Placed a 1 SOL-PERP LONG order`);


    await driftClient.placePerpOrder(
        getMarketOrderParams({
            baseAssetAmount: new BN(1).mul(BASE_PRECISION),
            direction: PositionDirection.SHORT,
            marketIndex: solPerpMarketAccount.marketIndex,
            reduceOnly: true // true if just want to sell the opposition position
        })
    );
    console.log(`Placed a 1 SOL-PERP LONG reduce order`);


    const solSpotMarketInfo = SpotMarkets[env].find(
        (market) => market.symbol === 'SOL'
    );
    if (solSpotMarketInfo?.marketIndex === undefined) {
        throw new Error('Could not find SOL Spot market');
    }

    await driftClient.deposit(
        new BN(1).mul(BASE_PRECISION),
        solSpotMarketInfo?.marketIndex,
        wallet.publicKey,
    );
    console.log(`Deposited 1 SOL into SPOT accont`);


    const associatedTokenAccount = await driftClient.getAssociatedTokenAccount(solSpotMarketInfo.marketIndex);
    await driftClient.withdraw(
        new BN(1).mul(BASE_PRECISION),
        solSpotMarketInfo?.marketIndex,
        associatedTokenAccount,
    );
    console.log(`Withdrawn 1 SOL from SPOT accont`);


    // borrow position
    await driftClient.placeSpotOrder(
        getMarketOrderParams({
            baseAssetAmount: new BN(1).mul(BASE_PRECISION),
            direction: PositionDirection.LONG,
            marketIndex: solSpotMarketInfo?.marketIndex,
        })
    );
    console.log(`Placed a 1 SOL-SPOT order`);


    // lend position
    await driftClient.placeSpotOrder(
        getMarketOrderParams({
            baseAssetAmount: new BN(1).mul(BASE_PRECISION),
            direction: PositionDirection.SHORT,
            marketIndex: solSpotMarketInfo?.marketIndex,
            reduceOnly: true // true if selling position, false if lending
        })
    );
    console.log(`Placed a 1 SOL-SPOT reduce order`);
};

main();