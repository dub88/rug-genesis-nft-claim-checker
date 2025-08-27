const express = require('express');
const axios = require('axios');
const { ethers } = require('ethers');
const cors = require('cors');
const NodeCache = require('node-cache');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Cache setup for prices (5 minute TTL)
const cache = new NodeCache({ stdTTL: 300 });

// Load environment variables
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;

// Constants
const COLLECTION_SLUG = 'ruggenesis-nft';
const CLAIM_CONTRACT_ADDRESS = '0x6923cc9c35230f0d18ef813a0f3aa88400c78409';
const RUG_TOKEN_ADDRESS = '0xD2d8D78087D0E43BC4804B6F946674b2Ee406b80';
const RUGGENESIS_NFT_ADDRESS = '0x8ff1523091c9517bc328223d50b52ef450200339';
const RUG_TOKEN_DECIMALS = 18;

// Claim contract ABI (only the functions we need)
const CLAIM_CONTRACT_ABI = [
  {
    "inputs": [{"internalType": "uint256", "name": "tokenId", "type": "uint256"}],
    "name": "getClaimAmount",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  }
];

// Initialize Ethereum provider
const provider = new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`);
const claimContract = new ethers.Contract(CLAIM_CONTRACT_ADDRESS, CLAIM_CONTRACT_ABI, provider);

// Fetch with retry for rate limits and other temporary errors
async function fetchWithRetry(url, options, retries = 3, delay = 1000) {
  try {
    return await axios(url, options);
  } catch (error) {
    // Handle rate limiting (429)
    if (error.response && error.response.status === 429 && retries > 0) {
      const retryAfter = error.response.headers['retry-after'] || delay / 1000;
      const retryDelayMs = parseInt(retryAfter) * 1000 || delay;
      
      console.log(`Rate limited (429), retrying in ${retryDelayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      return fetchWithRetry(url, options, retries - 1, retryDelayMs * 2);
    }
    
    // Handle server errors (5xx)
    if (error.response && error.response.status >= 500 && retries > 0) {
      console.log(`Server error (${error.response.status}), retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 2);
    }
    
    // Handle authentication errors
    if (error.response && error.response.status === 401) {
      console.error('Authentication error: API key may be invalid or expired');
      throw new Error('OpenSea API authentication failed - check your API key');
    }
    
    // Handle other errors
    throw error;
  }
}

// Get ETH price in USD
async function getEthPrice() {
  const cacheKey = 'eth_price';
  const cachedPrice = cache.get(cacheKey);
  
  if (cachedPrice) {
    return cachedPrice;
  }
  
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    const price = response.data.ethereum.usd;
    cache.set(cacheKey, price);
    return price;
  } catch (error) {
    console.error('Error fetching ETH price:', error);
    return 0;
  }
}

// Get RUG token price from DexScreener
async function getRugTokenPrice() {
  const cacheKey = 'rug_price';
  const cachedPrice = cache.get(cacheKey);
  
  if (cachedPrice) {
    return cachedPrice;
  }
  
  try {
    // DexScreener API for RUG token
    const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${RUG_TOKEN_ADDRESS}`);
    
    if (response.data && response.data.pairs && response.data.pairs.length > 0) {
      // Get the price from the first pair (usually the most liquid)
      const price = parseFloat(response.data.pairs[0].priceUsd);
      cache.set(cacheKey, price);
      return price;
    }
    return 0;
  } catch (error) {
    console.error('Error fetching RUG token price:', error);
    return 0;
  }
}

// Get claimable amount for a token ID
async function getClaimableAmount(tokenId) {
  try {
    const amount = await claimContract.getClaimAmount(tokenId);
    console.log(`Raw claimable amount for token ${tokenId}:`, amount.toString());
    
    // The contract is likely returning the raw value without decimals
    // Instead of using formatUnits with 18 decimals, we'll return the raw value
    return amount.toString();
  } catch (error) {
    console.error(`Error getting claimable amount for token ${tokenId}:`, error);
    return '0';
  }
}

// Get OpenSea listings
async function getOpenSeaListings(limit = 50, offset = 0) {
  try {
    // Ensure we have an API key
    if (!OPENSEA_API_KEY) {
      console.error('OpenSea API key is missing');
      return [];
    }
    
    const options = {
      headers: {
        'X-API-KEY': OPENSEA_API_KEY,
        'Accept': 'application/json'
      }
    };
    
    // Try v2 API first with updated endpoint
    // Based on OpenSea documentation, we should use the correct endpoint
    // Limit must be a maximum of 200 according to API response
    const adjustedLimit = Math.min(limit, 200);
    const v2Url = `https://api.opensea.io/api/v2/listings/collection/${COLLECTION_SLUG}/all?limit=${adjustedLimit}`;
    console.log(`Fetching OpenSea listings from v2 API: ${v2Url}`);
    
    try {
      console.log('Sending request to OpenSea API v2:', v2Url);
      console.log('Using headers:', JSON.stringify(options.headers));
      const v2Response = await fetchWithRetry(v2Url, options);
      console.log('OpenSea API v2 response status:', v2Response.status);
      
      // Check if response has data
      if (v2Response.data) {
        console.log('OpenSea API v2 response structure:', JSON.stringify(Object.keys(v2Response.data || {})));
        // Log a sample of the response data
        console.log('OpenSea API v2 response sample:', JSON.stringify(v2Response.data).substring(0, 1000));
      }
      
      // Handle different response formats
      let listings = [];
      if (v2Response.data && v2Response.data.listings && Array.isArray(v2Response.data.listings)) {
        listings = v2Response.data.listings;
        console.log(`Retrieved ${listings.length} listings from OpenSea v2 API`);
      } else if (v2Response.data && Array.isArray(v2Response.data)) {
        listings = v2Response.data;
        console.log(`Retrieved ${listings.length} listings from OpenSea v2 API (array format)`);
      }
      
      if (listings.length > 0) {
        return listings;
      }
      
      console.log('No listings found in v2 API response');
    } catch (v2Error) {
      console.error('Error with v2 API:', v2Error.message);
      if (v2Error.response) {
        console.error('v2 API Response status:', v2Error.response.status);
        console.error('v2 API Response data:', JSON.stringify(v2Error.response.data));
      }
    }
    
    // If we reach here, we couldn't find any listings
    console.log('No listings found in OpenSea API');
    return [];
  } catch (error) {
    console.error('Error fetching OpenSea listings:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data));
      console.error('Response headers:', JSON.stringify(error.response.headers));
    } else if (error.request) {
      console.error('No response received:', error.request);
    } else {
      console.error('Error setting up request:', error);
    }
    return [];
  }
}

app.get('/check-listings', async (req, res) => {
  try {
    // Get all listings at once
    const page = 0;
    const pageSize = 500; // Significantly increased page size to get all listings at once
    
    console.log(`Received request to /check-listings - fetching all listings`);
    
    // Get prices and listings in parallel
    const [ethPrice, rugPrice, listings] = await Promise.all([
      getEthPrice(),
      getRugTokenPrice(),
      getOpenSeaListings(pageSize, page)
    ]).catch(error => {
      console.error('Error in Promise.all:', error);
      throw error;
    });
    
    console.log(`Retrieved prices - ETH: $${ethPrice}, RUG: $${rugPrice}`);
    
    // Process each listing
    const processedListings = [];
    
    // Check if listings is an array
    if (!Array.isArray(listings)) {
      console.error('Invalid listings data type:', typeof listings);
      throw new Error('OpenSea API did not return a valid listings array');
    }
    
    // Handle case with no listings
    if (listings.length === 0) {
      console.log('No listings found from OpenSea API');
      return res.json({
        listings: [],
        ethPrice,
        rugPrice,
        timestamp: new Date().toISOString(),
        message: 'No active listings found on OpenSea'
      });
    }
    
    console.log(`Processing ${listings.length} listings from OpenSea`);
    
    // Process listings with a limit on concurrent requests to avoid rate limiting
    const concurrencyLimit = 5;
    const chunks = [];
    
    // Split listings into chunks for processing
    for (let i = 0; i < listings.length; i += concurrencyLimit) {
      chunks.push(listings.slice(i, i + concurrencyLimit));
    }
    
    // Process each chunk sequentially
    for (const chunk of chunks) {
      // Process listings in each chunk concurrently
      const chunkPromises = chunk.map(async (listing) => {
        try {
          // Validate listing structure based on the new OpenSea API v2 format
          if (!listing.protocol_data || !listing.protocol_data.parameters || !listing.protocol_data.parameters.offer || 
              !listing.price || !listing.price.current || !listing.price.current.value) {
            console.warn('Skipping invalid listing format');
            return null;
          }
          
          // Extract token ID from the offer parameters
          // In the new format, the token ID is in protocol_data.parameters.offer[0].identifierOrCriteria
          const offerItem = listing.protocol_data.parameters.offer[0];
          if (!offerItem || !offerItem.identifierOrCriteria) {
            console.warn('Missing offer item or identifier');
            return null;
          }
          
          const tokenId = offerItem.identifierOrCriteria;
          console.log(`Processing listing for token ID: ${tokenId}`);
          
          // Convert wei to ETH and format properly
          const priceWei = listing.price.current.value;
          // Use ethers.js to properly format the ETH value from wei
          const priceEth = ethers.formatEther(priceWei);
          // Format price in ETH with proper decimal places
          const formattedPriceEth = parseFloat(priceEth).toFixed(4);
          // Calculate USD price with proper formatting
          const priceUsd = (parseFloat(priceEth) * ethPrice).toFixed(2);
          
          // Get claimable amount
          const claimableAmount = await getClaimableAmount(tokenId);
          
          if (parseFloat(claimableAmount) > 0) {
            // Format the claimable amount for display
            const formattedClaimableAmount = claimableAmount;
            const claimableValueUsd = (parseFloat(claimableAmount) * rugPrice).toFixed(2);
            const netValueUsd = (parseFloat(claimableValueUsd) - parseFloat(priceUsd)).toFixed(2);
            
            return {
              tokenId,
              priceEth: formattedPriceEth,
              priceUsd,
              claimableAmount,
              claimableValueUsd,
              netValueUsd,
              openseaUrl: `https://opensea.io/assets/ethereum/${RUGGENESIS_NFT_ADDRESS}/${tokenId}`
            };
          }
          return null;
        } catch (listingError) {
          console.error('Error processing listing:', listingError.message);
          return null;
        }
      });
      
      // Wait for all listings in this chunk to be processed
      const results = await Promise.all(chunkPromises);
      processedListings.push(...results.filter(item => item !== null));
      
      // Add a small delay between chunks to avoid rate limiting
      if (chunks.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log(`Found ${processedListings.length} listings with claimable tokens`);
    
    // Sort by net value (descending)
    processedListings.sort((a, b) => parseFloat(b.netValueUsd) - parseFloat(a.netValueUsd));
    
    res.json({
      listings: processedListings,
      ethPrice,
      rugPrice,
      timestamp: new Date().toISOString(),
      page,
      limit: pageSize,
      hasMore: listings.length === pageSize, // If we got the full requested limit, there might be more
      message: processedListings.length > 0 ? 'Successfully retrieved listings' : 'No claimable listings found'
    });
  } catch (error) {
    console.error('Error processing listings:', error);
    res.status(500).json({ 
      error: 'Error processing listings', 
      message: error.message || 'Unknown error occurred',
      listings: [],
      ethPrice: 0,
      rugPrice: 0,
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint to check a specific token ID
app.get('/check-token/:tokenId', async (req, res) => {
  try {
    const { tokenId } = req.params;
    
    // Validate token ID
    if (!tokenId || isNaN(parseInt(tokenId))) {
      return res.status(400).json({ 
        error: 'Invalid token ID', 
        message: 'Token ID must be a valid number',
        timestamp: new Date().toISOString()
      });
    }
    
    console.log(`Checking token ID: ${tokenId}`);
    
    // Get price and claimable amount in parallel
    const [rugPrice, claimableAmount] = await Promise.all([
      getRugTokenPrice(),
      getClaimableAmount(tokenId)
    ]);
    
    console.log(`Token ${tokenId} - Claimable amount: ${claimableAmount}, RUG price: $${rugPrice}`);
    
    // Calculate claimable value using the raw amount
    const claimableValueUsd = (parseFloat(claimableAmount) * rugPrice).toFixed(2);
    
    res.json({
      tokenId,
      claimableAmount,
      rugPrice,
      claimableValueUsd,
      timestamp: new Date().toISOString(),
      message: parseFloat(claimableAmount) > 0 ? 'Token has claimable RUG' : 'Token has no claimable RUG'
    });
  } catch (error) {
    console.error('Error checking token:', error);
    res.status(500).json({ 
      error: 'Error checking token', 
      message: error.message || 'Unknown error occurred',
      timestamp: new Date().toISOString()
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 3002; // Changed to 3002 to avoid conflict
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
