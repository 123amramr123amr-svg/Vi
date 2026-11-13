# -*- coding: utf-8 -*-
"""Complete remaining studio.tsx edits using ASCII-only anchors (RTL-safe)."""

PATH = "src/components/vi/studio.tsx"
src = open(PATH, encoding="utf-8").read()

# 1) model label swap (unique ASCII anchor)
old_label = 'IMAGE_MODEL_LABEL : VIDEO_MODEL_LABEL}'
new_label = 'modelLabels.image : modelLabels.video}'
assert src.count(old_label) == 1, f"label occurrences: {src.count(old_label)}"
src = src.replace(old_label, new_label)

# 2) 6-column tabs list
assert src.count("sm:grid-cols-5") == 1
src = src.replace("sm:grid-cols-5", "sm:grid-cols-6")

# 3) settings tab trigger right after the MCP trigger
i = src.find('<TabsTrigger value="mcp"')
assert i != -1
j = src.find("</TabsTrigger>", i)
assert j != -1
j += len("</TabsTrigger>")
trigger = (
    '\n            <TabsTrigger value="settings" className="gap-1.5">'
    '\n              <Settings2 className="h-4 w-4" />'
    "\n              \u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a"
    "\n            </TabsTrigger>"
)
src = src[:j] + trigger + src[j:]

# 4) settings tab content right after MCP content
k = src.find('<TabsContent value="mcp" className="mt-0">')
assert k != -1
m = src.find("</TabsContent>", k)
assert m != -1
m += len("</TabsContent>")
content = (
    '\n          <TabsContent value="settings" className="mt-0">'
    "\n            <SettingsPanel onSaved={loadModelLabels} />"
    "\n          </TabsContent>"
)
src = src[:m] + content + src[m:]

open(PATH, "w", encoding="utf-8").write(src)
print("done: label, cols, trigger, content")
