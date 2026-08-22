/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * migrate-remove-base-recipes.ts — one-time migration to the VARIANT-ONLY
 * recipe model (no base recipes, no inheritance).
 *
 * See RecipeResolutionService.migrateRemoveBaseRecipes() for the logic.
 *
 * Run once, after deploying the variant-only backend:
 *   npx tsx scripts/migrate-remove-base-recipes.ts            # live
 *   npx tsx scripts/migrate-remove-base-recipes.ts --dry      # plan only
 */

import mongoose from 'mongoose';
import { config } from '../src/config';
import { recipeResolutionService } from '../src/modules/recipes/services/recipeResolutionService';

const dry = process.argv.includes('--dry');

async function run() {
  await mongoose.connect(config.mongoUri);
  console.log(`[migrate] connected to ${config.mongoUri}${dry ? ' — DRY RUN (nothing written)' : ''}`);

  const out = await recipeResolutionService.migrateRemoveBaseRecipes({ dry });

  console.log('\n[migrate] summary' + (dry ? ' (dry run)' : ''));
  console.log(`  base recipes processed : ${out.processed}`);
  console.log(`  renamed to 'Default'   : ${out.renamed}`);
  console.log(`  variant recipes copied : ${out.copied}`);
  console.log(`  base recipes archived  : ${out.archived}`);
  console.log(`  skipped                : ${out.skipped}`);
  console.log(`  errors                 : ${out.errors}`);

  await mongoose.disconnect();
}

run().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('[migrate] fatal:', err);
  process.exit(1);
});
