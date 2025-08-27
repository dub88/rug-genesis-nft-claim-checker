# RugGenesis NFT Claim Checker

A Node.js web application that checks claimable RUG tokens for RugGenesis NFTs listed on OpenSea. The application prioritizes NFTs with the highest net value (claimable value minus purchase cost).

## Features

- Fetches active OpenSea listings for RugGenesis NFTs
- Queries claimable RUG tokens using the claim contract
- Calculates net value based on real-time RUG token price from DexScreener
- Displays results in a sortable table
- Allows checking specific token IDs

## Tech Stack

- **Backend**: Node.js with Express
- **Frontend**: HTML, CSS, JavaScript
- **APIs**: OpenSea API, Alchemy, DexScreener
- **Libraries**: ethers.js, axios, node-cache

## Setup

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file with the following variables:
   ```
   OPENSEA_API_KEY=your_opensea_api_key
   ALCHEMY_API_KEY=your_alchemy_api_key
   ```
4. Start the server:
   ```
   npm start
   ```
5. Visit `http://localhost:3000` in your browser

## API Endpoints

- `GET /check-listings`: Returns NFTs with claimable tokens sorted by net value
- `GET /check-token/:tokenId`: Returns claimable amount for a specific token ID
- `GET /health`: Health check endpoint

### Response Format

#### `/check-listings`
```json
{
  "listings": [
    {
      "tokenId": "1234",
      "priceEth": "0.1500",
      "priceUsd": "675.61",
      "claimableAmount": "0.000000000000000075",
      "claimableValueUsd": "0.00",
      "netValueUsd": "-675.61",
      "openseaUrl": "https://opensea.io/assets/ethereum/0x8ff1523091c9517bc328223d50b52ef450200339/1234"
    }
  ],
  "ethPrice": 4504.04,
  "rugPrice": 0.1389,
  "timestamp": "2025-08-27T22:30:05.722Z",
  "message": "Successfully retrieved listings"
}
```

#### `/check-token/:tokenId`
```json
{
  "tokenId": "1234",
  "claimableAmount": "0.00000000000000195",
  "rugPrice": 0.1389,
  "claimableValueUsd": "0.00",
  "timestamp": "2025-08-27T22:30:22.861Z",
  "message": "Token has claimable RUG"
}
```

## Deployment

This project is configured for deployment on Vercel:

1. Push the project to a GitHub repository
2. Import the repository into Vercel
3. Set environment variables in the Vercel dashboard:
   - `OPENSEA_API_KEY`
   - `ALCHEMY_API_KEY`
4. Deploy the project

## Contract Information

- RugGenesis NFT: `0x8ff1523091c9517bc328223d50b52ef450200339`
- RUG Token: `0xD2d8D78087D0E43BC4804B6F946674b2Ee406b80`
- Claim Contract: `0x6923cc9c35230f0d18ef813a0f3aa88400c78409`

## Notes

- This application uses OpenSea API v2 for fetching listings
- OpenSea API has rate limits (~100 calls/day on free tier)
- The application implements retry logic with exponential backoff for rate limiting (HTTP 429)
- The application caches ETH and RUG token prices for 5 minutes to reduce API calls
- Results are limited to 50 listings initially, but can be increased if needed
- Listings are processed in chunks with concurrency limits to avoid rate limiting
