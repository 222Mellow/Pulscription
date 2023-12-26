export const environment = {
  env: 'dev-goerli',
  production: false,
  chainId: 5,
  rpcHttpProvider: 'http://goerli-geth.dappnode:8545',
  explorerUrl: 'https://goerli.etherscan.io',

  marketAddress: '0x6f67A6F9a1d334CD105170bCd685C518D5610601'.toLowerCase(),
  donationsAddress: '0x86a271a5C352efc2851753002b29faB2057f72a6'.toLowerCase(),
  pointsAddress: '0x117A605D32ca32972487971Dc166C6b4723142Fb'.toLowerCase(),
  auctionAddress: '0xc6a824D8cce7c946A3F35879694b9261A36fc823'.toLowerCase(),

  staticUrl: 'https://kcbuycbhynlmsrvoegzp.supabase.co/storage/v1/object/public',

  // Local
  // supabaseUrl: 'http://localhost:8000',
  // supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE',

  // Prod
  supabaseUrl: 'https://kcbuycbhynlmsrvoegzp.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtjYnV5Y2JoeW5sbXNydm9lZ3pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE2ODkyMTMzNTQsImV4cCI6MjAwNDc4OTM1NH0.jUvNzW6jrBPfKg9SvDhW5auqF8y_DKo4tmAmXCwgHAY',
};
