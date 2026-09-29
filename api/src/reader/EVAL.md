# The AI reader, measured

44 real pages (28 about bitcoin or the euro, 16 about neither), scored on the text the chip sends. Model: claude-haiku-4-5-20251001. Run: 2026-09-29.

| | Chips right (precision) | Pages found (recall) | Chips on pages about neither |
|---|---|---|---|
| Rules alone | 89% (8/9) | 29% (8/28) | 1 of 16 |
| Rules + AI reader | 95% (21/22) | 75% (21/28) | 1 of 16 |

The reader was asked about 26 of 44 texts (the rest had a rule answer or no sign of money). Cost of this run: 0.64 cents.

| Bucket | Text | Expected | Rules | Reader | Reader's line |
|---|---|---|---|---|---|
| 1 | Bitcoin hits new record high near $112,000 as rally marches on | bitcoin | bitcoin |  |  |
| 1 | Bitcoin falls to lowest level since Trump took office | bitcoin | bitcoin |  |  |
| 1 | Strategy sheds $216 million in Bitcoin in crypto hoarder’s largest sale ever | bitcoin | bitcoin |  |  |
| 1 | Bitcoin Hashprice Falls to Five-Year Low | bitcoin | bitcoin |  |  |
| 1 | El Salvador Defies IMF Again With Fresh Bitcoin Purchase Following Loan Review | bitcoin | bitcoin |  |  |
| 1 | BlackRock's bitcoin ETF sheds $528 million, the second-largest daily outflow on record | bitcoin | bitcoin |  |  |
| 1 | Texas buys the Bitcoin dip, acquiring $5M of BlackRock’s IBIT | bitcoin | bitcoin |  |  |
| 1 | A major historical bitcoin cycle that dictates its price might be breaking | bitcoin | bitcoin |  |  |
| 2 | 1 Top Cryptocurrency to Buy Before It Soars 236% During the Next 18 Months, According to T | bitcoin | - | none | Generic cryptocurrency investment advice not specifically about bitcoin. |
| 2 | Here's the 1 Crypto I'd Buy if I Could Only Pick 1 | bitcoin | - | none | Generic cryptocurrency investment advice not specifically about bitcoin. |
| 2 | Wisconsin Pension Fund Sold IBIT Before Trade Clash | bitcoin | - | bitcoin | A pension fund sold its bitcoin ETF shares before trade tensions. |
| 2 | Analyst predicts 35% upside for Saylor's Strategy | bitcoin | - | bitcoin | An analyst predicts gains for Michael Saylor's bitcoin strategy. |
| 2 | What Do Saylor’s Green Dots Mean? Secret Trigger? | bitcoin | - |  |  |
| 2 | How Michael Saylor’s preferred stock gamble could trigger a death spiral for Strategy | bitcoin | - | bitcoin | Michael Saylor's stock strategy could affect his bitcoin holdings. |
| 2 | Michael Saylor’s Strategy Nears “Danger Zone” as mNAV Threatens to Slip Below 1 | bitcoin | - |  |  |
| 2 | Twenty One Capital Goes Live on the NYSE – Now What? | bitcoin | - |  |  |
| 2 | Miners Approach the 2028 Halving in Tougher Conditions | bitcoin | - | bitcoin | Bitcoin miners facing difficult conditions as they approach the 2028 halving. |
| 2 | 1 Unstoppable Cryptocurrency to Buy Before It Soars 270% | bitcoin | - | none | Generic cryptocurrency investment advice not specifically about bitcoin. |
| 3 | European Central Bank cuts eurozone interest rates | euro | - | euro | The ECB cut eurozone interest rates affecting the euro currency. |
| 3 | European Central Bank keeps rates on hold in the face of inflation threat | euro | - | euro | ECB's rate decision affects euro currency value. |
| 3 | European Central Bank hikes interest rates to 2.5% as policymakers see risk of higher infl | euro | - | euro | ECB raises rates, which strengthens the euro. |
| 3 | Euro zone inflation cools to 1.7% in January, flash data shows | euro | - | none | Eurozone inflation data without currency implications. |
| 3 | Euro hits four-month peak; U.S. dollar languishes on tariff-driven fears | euro | - | euro | Euro reaches four-month high against the dollar. |
| 3 | Dollar edges lower against euro as markets trim rate hike bets | euro | - | euro | Dollar weakens against euro on rate expectations. |
| 3 | Why the euro's rise to $1.20 is a big deal | euro | - | euro | Euro breaks through $1.20 level, a significant price move. |
| 3 | The EUR/USD Paradox: A Strong Euro in a Weak Economy | euro | - | euro | EUR/USD exchange rate examined amid economic conditions. |
| 3 | BofA cuts euro forecasts, sees stronger dollar in second half on hawkish Fed | euro | - | euro | Bank of America forecasts stronger dollar, weaker euro. |
| 3 | The Euro Stages an Accidental Coup Against the Almighty Dollar | euro | - | euro | The euro is strengthening against the US dollar in foreign exchange markets. |
| 4 | Aston Villa win Europa League: Emi Martinez plays despite breaking finger | - | - |  |  |
| 4 | Euro 2028: Northern Ireland to host qualifying draw for tournament | - | - | none | About a European football tournament qualifying draw. |
| 4 | Eurovision 2026: Bulgaria wins with Bangaranga - but the UK comes last | - | - |  |  |
| 4 | EU agrees sanctions on Israeli settlers over West Bank violence | - | - |  |  |
| 4 | French AI lab Mistral releases new AI models as it looks to keep pace with OpenAI and Goog | - | - |  |  |
| 4 | Ethereum Price Swells as Fusaka Upgrade Goes Live | - | - | none | About Ethereum, a cryptocurrency not named bitcoin. |
| 4 | Solana Meme Coin Launchpad Pump.fun Debuts PumpSwap Exchange | - | - | none | About a Solana-based crypto trading platform. |
| 4 | US passes Genius Act, first major national crypto legislation | - | - | none | About US crypto legislation in general, not bitcoin specifically. |
| 4 | This Top Cryptocurrency Could Soar 2,600%, According to High-Profile Wall Street Strategis | - | - | none | Vague hype about an unspecified cryptocurrency. |
| 4 | Better Crypto Buy Right Now: Shiba Inu vs. Solana | - | - | none | Comparing two altcoins, neither of which is bitcoin. |
| 4 | Bitcoin Is Not the Only Cryptocurrency With a Halving. Here's Why It's Time to Put Zcash ( | - | bitcoin |  |  |
| 4 | Apple says iPhone 17 'most popular ever' as sales soar | - | - |  |  |
| 4 | Google announces Gemini 3 as battle with OpenAI intensifies | - | - |  |  |
| 4 | Education Department extends deadline for student loan interest rate discount | - | - | none | About US student loan policy. |
| 4 | Trump Accounts will auto-enroll children, potentially adding 60 million accounts: Treasury | - | - | none | Treasury announcement about bank account enrollment for children. |
| 4 | Ask an Advisor: Should I Pay Off a 2.375% Mortgage or Invest in 4% CDs With Retirement 7 Y | - | - | none | Personal finance question comparing mortgage payoff versus CD investment options. |
