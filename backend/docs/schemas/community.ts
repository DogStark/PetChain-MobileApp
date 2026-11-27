/*
 * OpenAPI schema definitions for Community and Forum endpoints.
 */

export const communitySchemas = {
  Post: {
    type: 'object',
    required: ['id', 'title', 'body', 'createdAt'],
    properties: {
      id: { type: 'string', example: '1' },
      title: { type: 'string', maxLength: 200, example: 'My dog refuses to eat kibble' },
      body: { type: 'string', maxLength: 5000, example: 'Any tips on switching to wet food?' },
      category: {
        type: 'string',
        enum: ['forum', 'tip', 'app'],
        example: 'forum',
        description: 'Community post category',
      },
      species: { type: 'string', example: 'dog' },
      breed: { type: 'string', example: 'Labrador Retriever' },
      authorId: { type: 'string', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
      authorName: { type: 'string', example: 'Jane Doe' },
      petId: { $ref: '#/components/schemas/UUID' },
      petName: { type: 'string', example: 'Buddy' },
      likes: { type: 'integer', minimum: 0, example: 12 },
      createdAt: { $ref: '#/components/schemas/ISODateTime' },
      updatedAt: { $ref: '#/components/schemas/ISODateTime' },
    },
  },

  CreatePostRequest: {
    type: 'object',
    required: ['title', 'body'],
    properties: {
      title: { type: 'string', maxLength: 200, example: 'My dog refuses to eat kibble' },
      body: { type: 'string', maxLength: 5000, example: 'Any tips on switching to wet food?' },
      category: {
        type: 'string',
        enum: ['forum', 'tip', 'app'],
        default: 'forum',
        example: 'forum',
      },
      species: { type: 'string', example: 'dog' },
      breed: { type: 'string', example: 'Labrador Retriever' },
      petId: { $ref: '#/components/schemas/UUID' },
      petName: { type: 'string', example: 'Buddy' },
      author_id: { type: 'string', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
    },
  },

  Comment: {
    type: 'object',
    required: ['id', 'postId', 'body', 'votes', 'verified', 'createdAt'],
    properties: {
      id: { type: 'string', example: '1' },
      postId: { type: 'string', example: '1' },
      body: { type: 'string', maxLength: 5000, example: 'Try mixing wet food in gradually.' },
      authorId: { type: 'string', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
      verified: {
        type: 'boolean',
        example: false,
        description: 'Whether the comment was authored by a verified vet',
      },
      votes: { type: 'integer', example: 3 },
      createdAt: { $ref: '#/components/schemas/ISODateTime' },
    },
  },

  CreateCommentRequest: {
    type: 'object',
    required: ['body'],
    properties: {
      body: { type: 'string', maxLength: 5000, example: 'Try mixing wet food in gradually.' },
      author_id: { type: 'string', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
      verified: { type: 'boolean', default: false, example: false },
    },
  },

  VoteCommentRequest: {
    type: 'object',
    required: ['delta'],
    properties: {
      delta: {
        type: 'integer',
        enum: [1, -1],
        example: 1,
        description: 'Upvote (1) or downvote (-1)',
      },
    },
  },

  Report: {
    type: 'object',
    required: ['id', 'targetType', 'targetId', 'reason', 'status', 'createdAt'],
    properties: {
      id: { $ref: '#/components/schemas/UUID' },
      targetType: {
        type: 'string',
        enum: ['post', 'comment'],
        example: 'post',
        description: 'Type of content being reported',
      },
      targetId: { type: 'string', example: '1' },
      reason: {
        type: 'string',
        enum: ['spam', 'harassment', 'misinformation', 'inappropriate', 'other'],
        example: 'spam',
      },
      details: { type: 'string', maxLength: 1000, example: 'Repeated promotional links.' },
      reporterId: { $ref: '#/components/schemas/UUID' },
      status: {
        type: 'string',
        enum: ['pending', 'reviewed', 'dismissed', 'actioned'],
        example: 'pending',
      },
      createdAt: { $ref: '#/components/schemas/ISODateTime' },
      updatedAt: { $ref: '#/components/schemas/ISODateTime' },
    },
  },

  CreateReportRequest: {
    type: 'object',
    required: ['targetType', 'targetId', 'reason'],
    properties: {
      targetType: { type: 'string', enum: ['post', 'comment'], example: 'post' },
      targetId: { type: 'string', example: '1' },
      reason: {
        type: 'string',
        enum: ['spam', 'harassment', 'misinformation', 'inappropriate', 'other'],
        example: 'spam',
      },
      details: { type: 'string', maxLength: 1000, example: 'Repeated promotional links.' },
    },
  },

  ModerationKeyword: {
    type: 'object',
    required: ['word', 'type'],
    properties: {
      word: { type: 'string', example: 'badword' },
      type: { type: 'string', enum: ['block', 'whitelist'], example: 'block' },
      addedBy: { type: 'string', example: 'admin@petchain.app' },
      createdAt: { $ref: '#/components/schemas/ISODateTime' },
    },
  },

  CreateModerationKeywordRequest: {
    type: 'object',
    required: ['word', 'type'],
    properties: {
      word: { type: 'string', example: 'badword' },
      type: { type: 'string', enum: ['block', 'whitelist'], example: 'block' },
      addedBy: { type: 'string', example: 'admin@petchain.app' },
    },
  },

  ContentFlaggedError: {
    type: 'object',
    required: ['success', 'code', 'suggestEdit', 'message'],
    properties: {
      success: { type: 'boolean', example: false },
      code: { type: 'string', enum: ['CONTENT_FLAGGED'], example: 'CONTENT_FLAGGED' },
      suggestEdit: {
        type: 'boolean',
        example: true,
        description: 'True when the content may be edited and resubmitted',
      },
      flaggedWords: { type: 'array', items: { type: 'string' }, example: ['badword'] },
      message: { type: 'string', example: 'Your post contains flagged language.' },
    },
  },
} as const;
