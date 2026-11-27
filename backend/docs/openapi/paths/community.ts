/**
 * OpenAPI path definitions for /community and /forum endpoints.
 */

const postIdParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'Post ID',
  example: '1',
};

const commentIdParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'Comment (answer) ID',
  example: '1',
};

const keywordParam = {
  name: 'word',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'Moderation keyword',
  example: 'badword',
};

const flaggedResponse = {
  description: 'Content flagged by moderation',
  content: {
    'application/json': { schema: { $ref: '#/components/schemas/ContentFlaggedError' } },
  },
};

export const communityPaths = {
  '/community/posts': {
    get: {
      tags: ['Community'],
      summary: 'List community posts',
      description: 'Returns all community posts, newest first.',
      operationId: 'listCommunityPosts',
      security: [{ BearerAuth: [] }],
      responses: {
        '200': {
          description: 'List of community posts',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  {
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Post' } },
                    },
                  },
                ],
              },
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },

    post: {
      tags: ['Community'],
      summary: 'Create a community post',
      description: 'Creates a community post in the `forum`, `tip`, or `app` category.',
      operationId: 'createCommunityPost',
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreatePostRequest' },
            example: {
              category: 'forum',
              title: 'My dog refuses to eat kibble',
              body: 'Any tips on switching to wet food?',
              petId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              petName: 'Buddy',
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Post created',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  { properties: { data: { $ref: '#/components/schemas/Post' } } },
                ],
              },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/community/posts/{id}/like': {
    post: {
      tags: ['Community'],
      summary: 'Like a community post',
      description: 'Increments the like counter of a community post.',
      operationId: 'likeCommunityPost',
      security: [{ BearerAuth: [] }],
      parameters: [postIdParam],
      responses: {
        '200': {
          description: 'Updated post',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  { properties: { data: { $ref: '#/components/schemas/Post' } } },
                ],
              },
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '404': { $ref: '#/components/responses/NotFound' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/community/posts/{id}': {
    delete: {
      tags: ['Community'],
      summary: 'Delete a community post',
      description: 'Deletes a community post. Only the author may delete their own post.',
      operationId: 'deleteCommunityPost',
      security: [{ BearerAuth: [] }],
      parameters: [postIdParam],
      responses: {
        '200': {
          description: 'Post deleted',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiResponse' },
                  {
                    properties: {
                      data: {
                        type: 'object',
                        properties: { deleted: { type: 'boolean', example: true } },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '404': { $ref: '#/components/responses/NotFound' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/forum/posts': {
    get: {
      tags: ['Community'],
      summary: 'List forum posts',
      description: 'Returns forum posts, newest first. Optionally filters by a search term.',
      operationId: 'listForumPosts',
      parameters: [
        {
          name: 'search',
          in: 'query',
          required: false,
          schema: { type: 'string' },
          description: 'Case-insensitive search across post title and body',
          example: 'kibble',
        },
      ],
      responses: {
        '200': {
          description: 'List of forum posts',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['success', 'posts'],
                properties: {
                  success: { type: 'boolean', example: true },
                  posts: { type: 'array', items: { $ref: '#/components/schemas/Post' } },
                },
              },
            },
          },
        },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },

    post: {
      tags: ['Community'],
      summary: 'Create a forum post',
      description:
        'Creates a forum post. Content is moderated before persisting; flagged content returns 422.',
      operationId: 'createForumPost',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreatePostRequest' },
            example: {
              title: 'My dog refuses to eat kibble',
              body: 'Any tips on switching to wet food?',
              species: 'dog',
              breed: 'Labrador Retriever',
              author_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Post created',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['success', 'post'],
                properties: {
                  success: { type: 'boolean', example: true },
                  post: { $ref: '#/components/schemas/Post' },
                },
              },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '422': flaggedResponse,
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/forum/posts/{id}': {
    get: {
      tags: ['Community'],
      summary: 'Get a forum post with its comments',
      description: 'Returns a single forum post together with its answers (comments).',
      operationId: 'getForumPost',
      parameters: [postIdParam],
      responses: {
        '200': {
          description: 'Post and its comments',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['success', 'post', 'answers'],
                properties: {
                  success: { type: 'boolean', example: true },
                  post: { $ref: '#/components/schemas/Post' },
                  answers: { type: 'array', items: { $ref: '#/components/schemas/Comment' } },
                },
              },
            },
          },
        },
        '404': { $ref: '#/components/responses/NotFound' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/forum/posts/{id}/answers': {
    post: {
      tags: ['Community'],
      summary: 'Comment on a forum post',
      description:
        'Adds an answer (comment) to a forum post. Content is moderated before persisting.',
      operationId: 'createForumComment',
      parameters: [postIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateCommentRequest' },
            example: {
              body: 'Try mixing wet food in gradually.',
              author_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              verified: false,
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Comment created',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['success', 'answer'],
                properties: {
                  success: { type: 'boolean', example: true },
                  answer: { $ref: '#/components/schemas/Comment' },
                },
              },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '404': { $ref: '#/components/responses/NotFound' },
        '422': flaggedResponse,
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/forum/answers/{id}/vote': {
    post: {
      tags: ['Community'],
      summary: 'Vote on a forum comment',
      description: 'Upvotes (`delta: 1`) or downvotes (`delta: -1`) a forum comment.',
      operationId: 'voteForumComment',
      parameters: [commentIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/VoteCommentRequest' },
            example: { delta: 1 },
          },
        },
      },
      responses: {
        '200': {
          description: 'Updated comment',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['success', 'answer'],
                properties: {
                  success: { type: 'boolean', example: true },
                  answer: { $ref: '#/components/schemas/Comment' },
                },
              },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '404': { $ref: '#/components/responses/NotFound' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/forum/reports': {
    post: {
      tags: ['Community'],
      summary: 'Report a forum post or comment',
      description: 'Submits a moderation report for a forum post or comment.',
      operationId: 'createForumReport',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateReportRequest' },
            example: {
              targetType: 'post',
              targetId: '1',
              reason: 'spam',
              details: 'Repeated promotional links.',
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Report created',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['success', 'report'],
                properties: {
                  success: { type: 'boolean', example: true },
                  report: { $ref: '#/components/schemas/Report' },
                },
              },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '404': { $ref: '#/components/responses/NotFound' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/forum/moderation/keywords': {
    get: {
      tags: ['Community'],
      summary: 'List moderation keywords',
      description: 'Admin endpoint returning all block and whitelist moderation keywords.',
      operationId: 'listModerationKeywords',
      security: [{ BearerAuth: [] }],
      responses: {
        '200': {
          description: 'List of moderation keywords',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['success', 'keywords'],
                properties: {
                  success: { type: 'boolean', example: true },
                  keywords: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/ModerationKeyword' },
                  },
                },
              },
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },

    post: {
      tags: ['Community'],
      summary: 'Add a moderation keyword',
      description: 'Admin endpoint adding a `block` or `whitelist` moderation keyword.',
      operationId: 'createModerationKeyword',
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateModerationKeywordRequest' },
            example: { word: 'badword', type: 'block', addedBy: 'admin@petchain.app' },
          },
        },
      },
      responses: {
        '201': {
          description: 'Keyword created',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['success', 'keyword'],
                properties: {
                  success: { type: 'boolean', example: true },
                  keyword: { $ref: '#/components/schemas/ModerationKeyword' },
                },
              },
            },
          },
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },

  '/forum/moderation/keywords/{word}': {
    delete: {
      tags: ['Community'],
      summary: 'Remove a moderation keyword',
      description: 'Admin endpoint removing a moderation keyword.',
      operationId: 'deleteModerationKeyword',
      security: [{ BearerAuth: [] }],
      parameters: [keywordParam],
      responses: {
        '200': {
          description: 'Keyword removed',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['success', 'removed'],
                properties: {
                  success: { type: 'boolean', example: true },
                  removed: { type: 'boolean', example: true },
                },
              },
            },
          },
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '404': { $ref: '#/components/responses/NotFound' },
        '500': { $ref: '#/components/responses/InternalServerError' },
      },
    },
  },
} as const;
