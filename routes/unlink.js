//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();
const async = require('async');
const utils = require('../utils');

router.use(function (req, res, next) {
  const memberOfOrganizations = [];
  const operations = req.app.settings.providers.operations;
  const username = req.legacyUserContext.usernames.github;
  async.each(operations.organizations, function (organization, callback) {
    organization.getMembership(username, function (error, result) {
      let state = null;
      if (result && result.state) {
        state = result.state;
      }
      if (state == 'active' || state == 'pending') {
        memberOfOrganizations.push(organization);
      }
      callback(error);
    });
  }, function (error) {
    if (error) {
      return next(error);
    }
    req.currentOrganizationMemberships = memberOfOrganizations;
    next();
  });
});

router.get('/', function (req, res, next) {
  const link = req.legacyUserContext.entities.link;
  const id = req.legacyUserContext.id.github;
  const operations = req.app.settings.providers.operations;
  const account = operations.getAccount(id);
  account.getManagedOrganizationMemberships((error, currentOrganizationMemberships) => {
    if (error) {
      return next(error);
    }
    var link = req.oss.entities.link;
    if (link && link.ghid) {
      return req.oss.render(req, res, 'unlink', 'Remove corporate link and organization memberships', {
        orgs: currentOrganizationMemberships,
      });
    } else {
      return next(new Error('No link could be found.'));
    }
  });
});

router.post('/', function (req, res, next) {
  const id = req.legacyUserContext.id.github;
  const operations = req.app.settings.providers.operations;
  const account = operations.getAccount(id);
  const insights = req.insights;
  account.terminate(error => {
    insights.trackEvent('PortalUserUnlink');
    // If the cache is bad, the storage entity will already be gone
    if (error && error.statusCode === 404) {
      insights.trackEvent('PortalUserUnlinkAlreadyUnlinked', error);
      error = null;
    }
    req.legacyUserContext.invalidateLinkCache(error => {
      if (error) {
        console.dir(error);
      }
    });
    if (error) {
      insights.trackException(error);
      return next(utils.wrapError(error, 'You were successfully removed from all of your organizations. However, a minor failure happened during a data housecleaning operation. Double check that you are happy with your current membership status on GitHub.com before continuing. Press Report Bug if you would like this handled for sure.'));
    }
    return res.redirect('/signout?unlink');
  });
});

module.exports = router;
