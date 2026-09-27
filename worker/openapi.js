export function swaggerHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ExamRush API - Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    body { margin: 0; padding: 0; background: #fafafa; }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      SwaggerUIBundle({
        url: '/api/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`
}

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "ExamRush API",
    version: "2.0.0",
    description: "Backend webapp ôn thi / tạo bài thi trắc nghiệm (Cloudflare Workers + D1)"
  },
  paths: {
    "/api/health": {
      get: {
        tags: ["Health"],
        summary: "Kiểm tra trạng thái hệ thống",
        responses: {
          "200": {
            description: "Thành công",
            content: { "application/json": { schema: { type: "object" } } }
          }
        }
      }
    },
    "/api/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Đăng ký tài khoản mới",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["username", "password"],
                properties: {
                  username: { type: "string" },
                  password: { type: "string" },
                  display_name: { type: "string" }
                }
              }
            }
          }
        },
        responses: {
          "201": { description: "Đăng ký thành công" },
          "400": { description: "Tên đăng nhập đã tồn tại" }
        }
      }
    },
    "/api/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Đăng nhập nhận JWT access token",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["username", "password"],
                properties: {
                  username: { type: "string" },
                  password: { type: "string" }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Đăng nhập thành công" },
          "401": { description: "Sai thông tin đăng nhập" }
        }
      }
    },
    "/api/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Lấy thông tin người dùng hiện tại",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Thông tin người dùng" },
          "401": { description: "Chưa xác thực" }
        }
      }
    },
    "/api/exams": {
      get: {
        tags: ["Exams"],
        summary: "Danh sách tất cả bài thi",
        responses: {
          "200": { description: "Danh sách bài thi" }
        }
      },
      post: {
        tags: ["Exams"],
        summary: "Tạo bài thi mới",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title", "questions"],
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  image_url: { type: "string" },
                  time_limit_seconds: { type: "integer" },
                  questions: { type: "array", items: { type: "object" } }
                }
              }
            }
          }
        },
        responses: {
          "201": { description: "Tạo bài thi thành công" }
        }
      }
    },
    "/api/exams/{id}": {
      get: {
        tags: ["Exams"],
        summary: "Chi tiết bài thi để làm bài (không kèm đáp án)",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } }
        ],
        responses: {
          "200": { description: "Chi tiết bài thi" },
          "404": { description: "Không tìm thấy bài thi" }
        }
      },
      put: {
        tags: ["Exams"],
        summary: "Cập nhật bài thi (chỉ chủ sở hữu)",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } }
        ],
        responses: {
          "200": { description: "Cập nhật thành công" },
          "403": { description: "Không có quyền sửa" }
        }
      },
      delete: {
        tags: ["Exams"],
        summary: "Xóa bài thi (chỉ chủ sở hữu)",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } }
        ],
        responses: {
          "204": { description: "Xóa thành công" }
        }
      }
    },
    "/api/exams/{id}/full": {
      get: {
        tags: ["Exams"],
        summary: "Lấy bài thi đầy đủ kèm đáp án đúng (chỉ chủ sở hữu)",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } }
        ],
        responses: {
          "200": { description: "Bài thi kèm đáp án đúng" }
        }
      }
    },
    "/api/exams/{id}/submit": {
      post: {
        tags: ["Exams"],
        summary: "Nộp bài thi và chấm điểm",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  answers: { type: "array", items: { type: "object" } },
                  duration_seconds: { type: "integer" }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Kết quả chấm thi" }
        }
      }
    },
    "/api/attempts": {
      get: {
        tags: ["History"],
        summary: "Lịch sử làm bài của người dùng hiện tại",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Danh sách lịch sử bài làm" }
        }
      }
    },
    "/api/attempts/{id}": {
      get: {
        tags: ["History"],
        summary: "Chi tiết một lần làm bài",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } }
        ],
        responses: {
          "200": { description: "Chi tiết bài làm và đáp án đúng/sai" }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT"
      }
    }
  }
}
