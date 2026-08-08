export const geometryVertexShader = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTexcoord;

uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform mat3 uNormalMatrix;

out vec3 vWorldNormal;
out vec2 vTexcoord;

void main() {
  vec4 worldPosition = uModel * vec4(aPosition, 1.0);
  vWorldNormal = normalize(uNormalMatrix * aNormal);
  vTexcoord = aTexcoord;
  gl_Position = uViewProjection * worldPosition;
}`;

export const geometryFragmentShader = `#version 300 es
precision highp float;

in vec3 vWorldNormal;
in vec2 vTexcoord;

uniform vec4 uBaseColor;
uniform float uMetallic;
uniform float uRoughness;
uniform bool uUseBaseColorTexture;
uniform bool uSelected;
uniform sampler2D uBaseColorTexture;

layout(location = 0) out vec4 outAlbedoMetallic;
layout(location = 1) out vec4 outNormalRoughness;

void main() {
  vec4 sampledColor = uUseBaseColorTexture
    ? texture(uBaseColorTexture, vTexcoord)
    : vec4(1.0);
  vec3 color = sampledColor.rgb * uBaseColor.rgb;
  if (uSelected) {
    color = mix(color, vec3(1.0, 0.48, 0.08), 0.22);
  }
  outAlbedoMetallic = vec4(color, clamp(uMetallic, 0.0, 1.0));
  outNormalRoughness = vec4(normalize(vWorldNormal) * 0.5 + 0.5, clamp(uRoughness, 0.045, 1.0));
}`;

export const shadowVertexShader = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
uniform mat4 uModel;
uniform mat4 uLightViewProjection;
void main() {
  gl_Position = uLightViewProjection * uModel * vec4(aPosition, 1.0);
}`;

export const shadowFragmentShader = `#version 300 es
precision highp float;
void main() {}
`;

export const fullscreenVertexShader = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 position = vec2(
    (gl_VertexID << 1) & 2,
    gl_VertexID & 2
  );
  vUv = position;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

export const lightingFragmentShader = `#version 300 es
precision highp float;

#define MAX_LIGHTS 32
const float PI = 3.14159265359;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uAlbedoMetallic;
uniform sampler2D uNormalRoughness;
uniform sampler2D uDepth;
uniform sampler2D uShadowMap;
uniform mat4 uInverseViewProjection;
uniform mat4 uLightViewProjection;
uniform vec3 uCameraPosition;
uniform vec2 uShadowTexel;
uniform float uExposure;
uniform bool uShadowsEnabled;
uniform int uDebugMode;
uniform int uLightCount;
uniform int uLightType[MAX_LIGHTS];
uniform vec3 uLightPosition[MAX_LIGHTS];
uniform vec3 uLightDirection[MAX_LIGHTS];
uniform vec3 uLightColor[MAX_LIGHTS];
uniform float uLightIntensity[MAX_LIGHTS];
uniform float uLightRange[MAX_LIGHTS];

vec3 reconstructWorldPosition(vec2 uv, float depth) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 world = uInverseViewProjection * clip;
  return world.xyz / max(world.w, 0.00001);
}

float distributionGGX(vec3 normal, vec3 halfway, float roughness) {
  float alpha = roughness * roughness;
  float alpha2 = alpha * alpha;
  float nDotH = max(dot(normal, halfway), 0.0);
  float denominator = nDotH * nDotH * (alpha2 - 1.0) + 1.0;
  return alpha2 / max(PI * denominator * denominator, 0.0001);
}

float geometrySchlickGGX(float nDotV, float roughness) {
  float r = roughness + 1.0;
  float k = (r * r) / 8.0;
  return nDotV / max(nDotV * (1.0 - k) + k, 0.0001);
}

float geometrySmith(vec3 normal, vec3 viewDirection, vec3 lightDirection, float roughness) {
  return geometrySchlickGGX(max(dot(normal, viewDirection), 0.0), roughness) *
    geometrySchlickGGX(max(dot(normal, lightDirection), 0.0), roughness);
}

vec3 fresnelSchlick(float cosine, vec3 baseReflectance) {
  return baseReflectance + (1.0 - baseReflectance) * pow(clamp(1.0 - cosine, 0.0, 1.0), 5.0);
}

float sampleShadow(vec3 worldPosition, vec3 normal, vec3 lightDirection) {
  if (!uShadowsEnabled) return 1.0;
  vec4 lightClip = uLightViewProjection * vec4(worldPosition, 1.0);
  vec3 projected = lightClip.xyz / lightClip.w;
  projected = projected * 0.5 + 0.5;
  if (projected.z <= 0.0 || projected.z >= 1.0 ||
      projected.x <= 0.0 || projected.x >= 1.0 ||
      projected.y <= 0.0 || projected.y >= 1.0) {
    return 1.0;
  }
  float bias = max(0.0008 * (1.0 - dot(normal, lightDirection)), 0.00018);
  float visibility = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float closest = texture(uShadowMap, projected.xy + vec2(x, y) * uShadowTexel).r;
      visibility += projected.z - bias <= closest ? 1.0 : 0.0;
    }
  }
  return visibility / 9.0;
}

vec3 acesToneMap(vec3 color) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((color * (a * color + b)) / (color * (c * color + d) + e), 0.0, 1.0);
}

void main() {
  float depth = texture(uDepth, vUv).r;
  if (depth >= 0.999999) {
    float horizon = smoothstep(0.0, 0.8, vUv.y);
    vec3 background = mix(vec3(0.025, 0.03, 0.035), vec3(0.075, 0.085, 0.09), horizon);
    outColor = vec4(background, 1.0);
    return;
  }

  vec4 albedoMetallic = texture(uAlbedoMetallic, vUv);
  vec4 normalRoughness = texture(uNormalRoughness, vUv);
  vec3 albedo = albedoMetallic.rgb;
  float metallic = albedoMetallic.a;
  vec3 normal = normalize(normalRoughness.rgb * 2.0 - 1.0);
  float roughness = normalRoughness.a;

  if (uDebugMode == 1) {
    outColor = vec4(pow(albedo, vec3(1.0 / 2.2)), 1.0);
    return;
  }
  if (uDebugMode == 2) {
    outColor = vec4(normal * 0.5 + 0.5, 1.0);
    return;
  }
  if (uDebugMode == 3) {
    float linearized = pow(1.0 - depth, 10.0);
    outColor = vec4(vec3(linearized), 1.0);
    return;
  }

  vec3 worldPosition = reconstructWorldPosition(vUv, depth);
  vec3 viewDirection = normalize(uCameraPosition - worldPosition);
  vec3 baseReflectance = mix(vec3(0.04), albedo, metallic);
  vec3 lighting = albedo * 0.018;
  bool shadowConsumed = false;

  for (int index = 0; index < MAX_LIGHTS; index++) {
    if (index >= uLightCount) break;
    vec3 lightDirection;
    vec3 radiance;
    float visibility = 1.0;
    if (uLightType[index] == 0) {
      lightDirection = normalize(-uLightDirection[index]);
      radiance = uLightColor[index] * uLightIntensity[index];
      if (!shadowConsumed) {
        visibility = sampleShadow(worldPosition, normal, lightDirection);
        shadowConsumed = true;
      }
    } else {
      vec3 toLight = uLightPosition[index] - worldPosition;
      float distanceToLight = length(toLight);
      lightDirection = toLight / max(distanceToLight, 0.0001);
      float normalizedDistance = distanceToLight / max(uLightRange[index], 0.001);
      float attenuation = pow(clamp(1.0 - pow(normalizedDistance, 4.0), 0.0, 1.0), 2.0) /
        max(distanceToLight * distanceToLight, 0.2);
      radiance = uLightColor[index] * uLightIntensity[index] * attenuation;
    }

    vec3 halfway = normalize(viewDirection + lightDirection);
    float nDotL = max(dot(normal, lightDirection), 0.0);
    float nDotV = max(dot(normal, viewDirection), 0.0);
    float distribution = distributionGGX(normal, halfway, roughness);
    float geometry = geometrySmith(normal, viewDirection, lightDirection, roughness);
    vec3 fresnel = fresnelSchlick(max(dot(halfway, viewDirection), 0.0), baseReflectance);
    vec3 specular = distribution * geometry * fresnel /
      max(4.0 * nDotV * nDotL, 0.0001);
    vec3 diffuseWeight = (vec3(1.0) - fresnel) * (1.0 - metallic);
    lighting += (diffuseWeight * albedo / PI + specular) * radiance * nDotL * visibility;
  }

  vec3 mapped = acesToneMap(lighting * uExposure);
  outColor = vec4(pow(mapped, vec3(1.0 / 2.2)), 1.0);
}`;

export const pickingVertexShader = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
uniform mat4 uModel;
uniform mat4 uViewProjection;
void main() {
  gl_Position = uViewProjection * uModel * vec4(aPosition, 1.0);
}`;

export const pickingFragmentShader = `#version 300 es
precision highp float;
uniform vec3 uObjectColor;
out vec4 outColor;
void main() {
  outColor = vec4(uObjectColor, 1.0);
}`;
