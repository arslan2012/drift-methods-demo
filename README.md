# 代码详解：使用@drift-labs/sdk的交易脚本

本文的主旨是介绍下面的代码：该代码展示了如何在Solana网络上生成交易，代码涉及到了各种类型的交易，包括创建账户，存入抵押品，创建订单，借入/借出头寸等。

```JavaScript
import 'dotenv/config';
import * as bs58 from "bs58";
// ... 导入其他相关依赖项
```

上述代码导入了开发者必需的库和配置。其中：

- `dotenv/config`用于加载`.env`中的环境变量，这些环境变量在代码中引用。
- `bs58`库用来将base58编码的字符串解码为原始的字节序列。

## 函数 `getTokenAddress`

```JavaScript
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
```

`getTokenAddress`函数从用户提供的币种mint地址和用户公钥生成并返回一个关联token账户的地址。

## placePerpOrder

`placePerpOrder()`是一个在Drift协议创建永续合约订单的函数。以下是它的函数签名和参数信息：

```JavaScript
await driftClient.placePerpOrder(
    getMarketOrderParams({
        baseAssetAmount: new BN(1).mul(BASE_PRECISION),
        direction: PositionDirection.LONG,
        marketIndex: solPerpMarketAccount.marketIndex,
    })
);
```

它采取以下参数：

- `baseAssetAmount`: 交易的基础资产数量。在本示例中，它设置为1 SOL。

- `direction`: 表示交易的方向，可以是`LONG`（看涨）或者`SHORT`（看跌）。

- `marketIndex`: 唯一指定永续合约市场的索引。你可以通过SDK内置的`PerpMarkets`数组获得每个币的索引。每个具体市场（如BTC/USDT, ETH/USDT等）都有对应的市场索引。

## deposit

`deposit()`是一个在Drift协议中向现货账户存入抵押物的函数。以下是它的函数签名和参数信息：

```JavaScript
await driftClient.deposit(
    new BN(1).mul(BASE_PRECISION),
    solSpotMarketInfo?.marketIndex,
    wallet.publicKey,
);
```

调用参数为：

- 第一个参数是你想要存入的基础资产数量，在本例中，是1 SOL。

- 第二个参数是通过SDK内置的`SpotMarkets`数组指定市场的索引。

- 第三个参数是关联的代币帐户，你可以使用`driftClient.getAssociatedTokenAccount`获得。或者直接用钱包公钥代表SOL。

## withdraw

`withdraw()`是一个在Drift协议中从你的现货账户提取抵押物的方法。以下是它的函数签名和参数信息：

```JavaScript
await driftClient.withdraw(
    new BN(1).mul(BASE_PRECISION),
    solSpotMarketInfo?.marketIndex,
    associatedTokenAccount,
);
```

调用参数：

- 第一个参数是你想要提取的基础资产数量，在本例子中，是1 SOL。

- 第二个参数是通过SDK内置的`SpotMarkets`数组指定市场的索引。

- 第三个参数是关联的代币帐户，你可以使用`driftClient.getAssociatedTokenAccount`获得。

## placeSpotOrder

`placeSpotOrder()`是一个在Drift协议创建现货市场订单的方法。下面是它的函数签名和参数信息：

```JavaScript
await driftClient.placeSpotOrder(
    getMarketOrderParams({
        baseAssetAmount: new BN(1).mul(BASE_PRECISION),
        direction: PositionDirection.LONG,
        marketIndex: solSpotMarketInfo?.marketIndex,
    })
);
```

调用参数含义：

- `baseAssetAmount`: 交易的基础资产数量。在本示例中，它是设置为1 SOL。

- `direction`: 表示交易的方向，可以是`LONG`（做多）或者`SHORT`（做空）。

- `marketIndex`: 唯一指定现货市场的索引。你可以通过SDK内置的`SpotMarkets`数组获得每个币的索引。每个具体市场（如BTC/USDT, ETH/USDT等）都有对应的市场索引。

## 卖出

drift没有卖出方法，卖出是通过reduceOnly实现的。
"reduceOnly"（仅减少）是在衍生品交易中使用的标志，特别是在期货和永续合约中。当下一个"reduceOnly"订单时，意思是该订单只能减少现有的头寸，不能增加。这用于管理风险和限制潜在的损失。

假设你在永续合约中持有10个BTC的多头头寸。在这基础上，你决定下一个"reduceOnly"的卖出订单，数量为3个BTC。在这种情况下，一旦该订单执行，你的头寸将减少3个BTC。所以，"reduceOnly"的含义就是这个订单只有在减少你的持仓量的时候才会执行。如果这个订单会增加你的持仓量（例如，你没有任何多头位置，却尝试下一个"reduceOnly"的卖出订单），那么这个订单就不会被执行。
