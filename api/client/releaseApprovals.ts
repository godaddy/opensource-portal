//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
import asyncHandler from 'express-async-handler';
const router = express.Router();

import { ReposAppRequest, IProviders } from '../../transitional';
import { getReviewService } from './reviewService';
import { jsonError } from '../../middleware/jsonError';

const releaseApprovalsRedisKey = 'release-approvals';

router.get('/', asyncHandler(async (req: ReposAppRequest, res, next) => {
  const { cacheProvider } = req.app.settings.providers as IProviders;
  try {
    const reviewService = getReviewService(req.app.settings.runtimeConfig);
    const data = await cacheProvider.getObject(releaseApprovalsRedisKey);
    if (data) {
      return res.json({ releaseApprovals: data });
    }
    const reviews = await reviewService.getAllReleaseReviews();
    await cacheProvider.setObjectWithExpire(releaseApprovalsRedisKey, reviews, 60 * 24);
    res.json({ releaseApprovals: reviews });
  } catch (error) {
    return next(jsonError(error, 400));
  }
}));

router.post('/', asyncHandler(async (req: ReposAppRequest, res, next) => {
  const { graphProvider, cacheProvider, insights } = req.app.settings.providers as IProviders;
  try {
    const context = req.individualContext || req.apiContext;
    const id = context.corporateIdentity.id;
    const body = req.body;
    if (!body) {
      return next(jsonError('No body', 400));
    }
    let alias = null;
    try {
      const graph = await graphProvider.getUserById(id);
      if (graph && graph.mailNickname) {
        alias = graph.mailNickname;
      }
      if (!alias) {
        throw new Error(`Given the user ID of ${id}, we were unable to find the alias of address for the user`);
      }
    } catch (getAliasError) {
      return next(jsonError(new Error(getAliasError.message)));
    }
    const reviewService = getReviewService(req.app.settings.runtimeConfig);
    const response = await reviewService.submitReleaseRequestBatch({
      context: {
        user: alias,
      },
      requests: body,
    });
    insights.trackEvent({
      name: 'ApiClientCreateReleaseApproval',
      properties: {
        requestBody: JSON.stringify(body),
        responseBody: JSON.stringify(response),
      },
    });
    const result = response[0];
    if (result.issue || result.error) {
      return next(jsonError(new Error(result.issue || result.error || 'Failed to create new release registration')));
    }
    const reviews = await reviewService.getAllReleaseReviews();
    await cacheProvider.setObjectWithExpire(releaseApprovalsRedisKey, reviews, 60 * 24);
    // BUG in the implementation: seemed to be sending multiple results! return res.json({ releaseApprovals: reviews });
    return res.json({
      releaseApprovals: [result.review]
    });
  } catch (error) {
    return next(jsonError(error));
  }
}));

export default router;
